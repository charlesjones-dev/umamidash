import { DurableObject } from 'cloudflare:workers'
import type { GeocodedSession } from '../src/types/index.ts'
import { REALTIME_HEARTBEAT } from '../src/lib/realtime-protocol.ts'
import { parseSettings, type Settings } from '../core/config.ts'
import { fetchGeocodedSessions, Geocoder, type Coordinates, type GeocodeCache } from '../core/geocode.ts'
import { RealtimePoller } from '../core/poller.ts'
import { CallBudget, errorMessage, systemClock, type KeyValueStore } from '../core/runtime.ts'
import { UmamiClient, type UmamiTransport } from '../core/umami-client.ts'
import type { Env } from './env.ts'

/**
 * Most calls to Umami in one invocation of the hub. Cloudflare allows 32
 * service-binding calls per invocation. 25 leaves room to spare.
 */
export const MAX_UMAMI_CALLS_PER_INVOCATION = 25
/**
 * Most Nominatim requests for one map request. With the Umami calls, one
 * request stays inside the Workers Free plan's 50 subrequests. Places left
 * over are looked up on the next request.
 */
export const MAX_GEOCODE_REQUESTS_PER_CALL = 20
/** The one hub every request goes to. */
export const HUB_NAME = 'global'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
}

interface Runtime {
  settings: Settings
  client: UmamiClient
  poller: RealtimePoller
  geocoder: Geocoder
}

/**
 * One Durable Object for every browser. It holds the Umami token, polls Umami
 * on an alarm while at least one browser is connected, and sends each result
 * to every browser. It keeps its state and the geocoding cache in its SQLite
 * storage.
 *
 * Browsers connect with hibernatable WebSockets. Between alarms the object
 * has nothing pending, so it can hibernate and isn't billed for duration. An
 * SSE stream keeps it in memory (and billed) while it is open. SSE stays for
 * browsers that still run an older build of the app.
 */
export class RealtimeHub extends DurableObject<Env> {
  #sseClients = new Set<WritableStreamDefaultWriter<Uint8Array>>()
  #encoder = new TextEncoder()
  #runtime: Runtime | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS geocode (key TEXT PRIMARY KEY, lat REAL, lng REAL)',
    )
  }

  async fetch(request: Request): Promise<Response> {
    const runtime = this.#getRuntime()
    const payload = payloadOf(runtime.poller.snapshot())

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const { 0: browser, 1: server } = new WebSocketPair()
      this.ctx.acceptWebSocket(server)
      if (payload) server.send(payload)
      await this.#ensurePolling()
      return new Response(null, { status: 101, webSocket: browser })
    }

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    this.#sseClients.add(writer)
    writer.closed.then(
      () => this.#sseClients.delete(writer),
      () => this.#sseClients.delete(writer),
    )
    void this.#writeSse(writer, payload ? `\ndata: ${payload}\n\n` : '\n')
    await this.#ensurePolling()
    return new Response(readable, { headers: SSE_HEADERS })
  }

  /** The sessions of the window for the map, geocoded through the shared cache. */
  async geoSessions(websiteId: string, windowMinutes: number): Promise<GeocodedSession[]> {
    const { client, geocoder } = this.#getRuntime()
    return fetchGeocodedSessions(websiteId, windowMinutes, {
      client,
      geocoder,
      clock: systemClock,
      umamiBudget: new CallBudget(MAX_UMAMI_CALLS_PER_INVOCATION),
      geocodeBudget: new CallBudget(MAX_GEOCODE_REQUESTS_PER_CALL),
    })
  }

  async alarm(): Promise<void> {
    const browsers = this.ctx.getWebSockets().length + this.#sseClients.size
    if (browsers === 0) return // Nobody is watching: stop polling until someone connects.

    const { poller, settings } = this.#getRuntime()
    const started = Date.now()
    let nextDelayMs = settings.pollIntervalMs
    try {
      const result = await poller.tick()
      nextDelayMs = result.nextDelayMs
      this.#broadcast(result.changed ? payloadOf(result.snapshot) : '')
      const ms = Date.now() - started
      console.log(
        `tick calls=${result.calls} ms=${ms} browsers=${browsers} changed=${result.changed}` +
          (result.loginOnly ? ' login' : ''),
      )
      for (const error of result.errors) console.error('Poll error:', error)
    } catch (err) {
      console.error('Poll error:', errorMessage(err))
    }
    // Catch every error and reschedule, because Cloudflare retries a failed alarm only 6 times.
    await this.ctx.storage.setAlarm(Date.now() + nextDelayMs)
  }

  async #ensurePolling(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now())
  }

  /** Sends new data, or the heartbeat when `payload` is empty, to every browser. */
  #broadcast(payload: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload || REALTIME_HEARTBEAT)
      } catch (err) {
        console.warn('WebSocket send failed:', errorMessage(err))
      }
    }
    const sse = payload ? `data: ${payload}\n\n` : `: ${REALTIME_HEARTBEAT}\n\n`
    for (const writer of this.#sseClients) void this.#writeSse(writer, sse)
  }

  async #writeSse(writer: WritableStreamDefaultWriter<Uint8Array>, text: string): Promise<void> {
    try {
      await writer.write(this.#encoder.encode(text))
    } catch (err) {
      // The browser went away. Its writer closes, which removes it from the set.
      console.log('SSE client gone:', errorMessage(err))
      this.#sseClients.delete(writer)
    }
  }

  #getRuntime(): Runtime {
    if (this.#runtime) return this.#runtime
    const parsed = parseSettings(this.env, { endpointOptional: Boolean(this.env.UMAMI) })
    if (!parsed.ok) throw new Error(`Invalid configuration: ${parsed.errors.join('; ')}`)
    const settings = parsed.settings
    const store: KeyValueStore = this.ctx.storage.kv
    const client = new UmamiClient({
      transport: umamiTransport(this.env, settings),
      username: settings.username,
      password: settings.password,
      store,
      clock: systemClock,
    })
    const poller = new RealtimePoller({
      client,
      websites: settings.websites,
      pollIntervalMs: settings.pollIntervalMs,
      maxCallsPerTick: MAX_UMAMI_CALLS_PER_INVOCATION,
      store,
      clock: systemClock,
      timeZone: 'UTC',
    })
    const geocoder = new Geocoder({ cache: sqlGeocodeCache(this.ctx.storage.sql), clock: systemClock })
    this.#runtime = { settings, client, poller, geocoder }
    return this.#runtime
  }
}

function payloadOf(snapshot: unknown[]): string {
  return snapshot.length > 0 ? JSON.stringify(snapshot) : ''
}

/**
 * The service binding when one is bound, else `fetch` to UMAMI_API_ENDPOINT.
 * Calls through the binding use an https:// URL on the public Umami host, so
 * the Worker behind the binding sees the same URL a browser would.
 */
export function umamiTransport(env: Env, settings: Settings): UmamiTransport {
  const binding = env.UMAMI
  if (binding) {
    const base = `https://${new URL(settings.umamiPublicUrl).host}`
    return (path, init) => binding.fetch(new Request(`${base}${path}`, init))
  }
  const endpoint = settings.umamiApiEndpoint
  if (!endpoint) throw new Error('UMAMI_API_ENDPOINT is required without the UMAMI service binding')
  return (path, init) => fetch(`${endpoint}${path}`, init)
}

function sqlGeocodeCache(sql: SqlStorage): GeocodeCache {
  return {
    get(key) {
      const row = sql
        .exec<{ lat: number | null; lng: number | null }>('SELECT lat, lng FROM geocode WHERE key = ?', key)
        .toArray()[0]
      if (!row) return undefined
      return row.lat === null || row.lng === null ? null : ({ lat: row.lat, lng: row.lng } satisfies Coordinates)
    },
    set(key, value) {
      sql.exec(
        'INSERT OR REPLACE INTO geocode (key, lat, lng) VALUES (?, ?, ?)',
        key,
        value?.lat ?? null,
        value?.lng ?? null,
      )
    },
  }
}
