import type { GeocodedSession } from '../src/types/index.ts'
import { CallBudget, errorMessage, isRecord, UNLIMITED, type Clock } from './runtime.ts'
import type { UmamiClient } from './umami-client.ts'

export const GEO_WINDOWS_MINUTES = [5, 30, 360, 720, 1440, 10080] as const
const DEFAULT_WINDOW_MINUTES = 5
const SESSIONS_PAGE_SIZE = 200
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const NOMINATIM_USER_AGENT = 'UmamiDash/1.0'
/** Nominatim's usage policy allows at most 1 request a second. */
const NOMINATIM_INTERVAL_MS = 1000

export interface Coordinates {
  lat: number
  lng: number
}

/**
 * Geocoding results by place. `null` means Nominatim knows no such place.
 * `undefined` means the place was never looked up.
 */
export interface GeocodeCache {
  get(key: string): Coordinates | null | undefined
  set(key: string, value: Coordinates | null): void
}

export function memoryGeocodeCache(): GeocodeCache {
  const map = new Map<string, Coordinates | null>()
  return { get: (key) => map.get(key), set: (key, value) => void map.set(key, value) }
}

export function parseWindowMinutes(value: string | null | undefined): number {
  const minutes = Number.parseInt(value ?? '', 10)
  return (GEO_WINDOWS_MINUTES as readonly number[]).includes(minutes) ? minutes : DEFAULT_WINDOW_MINUTES
}

interface Place {
  country: string
  region: string
  city: string
}

function placeKey(place: Place): string {
  return `${place.country}:${place.region}:${place.city}`
}

export interface GeocoderOptions {
  cache: GeocodeCache
  clock: Clock
  fetch?: typeof fetch
}

/**
 * Looks places up on Nominatim with structured queries, at most 1 request a
 * second across every caller of this instance, and caches the results.
 */
export class Geocoder {
  #cache: GeocodeCache
  #clock: Clock
  #fetch: typeof fetch
  #queue: Promise<unknown> = Promise.resolve()
  #lastRequestAt = Number.NEGATIVE_INFINITY

  constructor(options: GeocoderOptions) {
    this.#cache = options.cache
    this.#clock = options.clock
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init))
  }

  /**
   * Coordinates for `place`, or null if Nominatim doesn't know it. Returns
   * undefined when `budget` ran out before an answer, so nothing is cached.
   */
  lookup(place: Place, budget: CallBudget): Promise<Coordinates | null | undefined> {
    const run = this.#queue.then(() => this.#lookup(place, budget))
    this.#queue = run.catch((err: unknown) => {
      console.error('Geocoding failed:', errorMessage(err))
    })
    return run
  }

  async #lookup(place: Place, budget: CallBudget): Promise<Coordinates | null | undefined> {
    const key = placeKey(place)
    const cached = this.#cache.get(key)
    if (cached !== undefined) return cached

    // "US-GA" → "GA"
    const state = place.region.includes('-') ? place.region.split('-').slice(1).join('-') : place.region
    const { country, city } = place
    const queries: Record<string, string>[] = []
    if (city && state && country) queries.push({ city, state, country })
    if (city && country) queries.push({ city, country })
    if (country) queries.push({ country })

    let failed = false
    for (const query of queries) {
      if (budget.remaining <= 0) return undefined
      budget.take()
      await this.#waitForSlot()
      try {
        const qs = new URLSearchParams({ format: 'json', limit: '1', ...query })
        const res = await this.#fetch(`${NOMINATIM_URL}?${qs}`, {
          headers: { 'User-Agent': NOMINATIM_USER_AGENT },
        })
        if (!res.ok) {
          failed = true
          await res.body?.cancel()
          continue
        }
        const results: unknown = await res.json()
        const first = Array.isArray(results) ? results[0] : undefined
        if (isRecord(first)) {
          const coords = { lat: Number(first.lat), lng: Number(first.lon) }
          if (Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
            this.#cache.set(key, coords)
            return coords
          }
        }
      } catch (err) {
        failed = true
        console.warn('Nominatim request failed:', errorMessage(err))
      }
    }

    // Cache "not found" only when Nominatim answered every query. An error
    // may pass, so the place is tried again on the next request.
    if (!failed) this.#cache.set(key, null)
    return null
  }

  async #waitForSlot(): Promise<void> {
    const wait = this.#lastRequestAt + NOMINATIM_INTERVAL_MS - this.#clock.now()
    if (wait > 0) await this.#clock.sleep(wait)
    this.#lastRequestAt = this.#clock.now()
  }
}

export interface GeoSessionsOptions {
  client: UmamiClient
  geocoder: Geocoder
  clock: Clock
  /** Calls to Umami for this request. */
  umamiBudget?: CallBudget
  /**
   * Nominatim requests for this request. The Worker caps it, so one map
   * request stays inside the Free plan's 50 subrequests. Places left over
   * are looked up on the next request.
   */
  geocodeBudget?: CallBudget
}

/** The sessions of the window, each placed on the map by its city. */
export async function fetchGeocodedSessions(
  websiteId: string,
  windowMinutes: number,
  options: GeoSessionsOptions,
): Promise<GeocodedSession[]> {
  const { client, geocoder, clock } = options
  const geocodeBudget = options.geocodeBudget ?? new CallBudget(UNLIMITED)
  const now = clock.now()
  const params = new URLSearchParams({
    startAt: String(now - windowMinutes * 60 * 1000),
    endAt: String(now),
    pageSize: String(SESSIONS_PAGE_SIZE),
  })
  const data = await client.get(
    `/api/websites/${encodeURIComponent(websiteId)}/sessions?${params}`,
    options.umamiBudget,
  )
  const list = isRecord(data) && Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []
  const sessions = list.filter(isRecord)

  const places = new Map<string, Place>()
  for (const s of sessions) {
    const place = placeOf(s)
    places.set(placeKey(place), place)
  }
  const coords = new Map<string, Coordinates>()
  for (const [key, place] of places) {
    const found = await geocoder.lookup(place, geocodeBudget)
    if (found) coords.set(key, found)
  }

  const result: GeocodedSession[] = []
  for (const s of sessions) {
    const place = placeOf(s)
    const c = coords.get(placeKey(place))
    if (!c) continue
    result.push({
      id: text(s.id),
      ...place,
      lat: c.lat,
      lng: c.lng,
      browser: text(s.browser),
      os: text(s.os),
      device: text(s.device),
      screen: text(s.screen),
      language: text(s.language),
      firstAt: text(s.firstAt) || text(s.createdAt),
      lastAt: text(s.lastAt) || text(s.createdAt),
    })
  }
  return result
}

function placeOf(s: Record<string, unknown>): Place {
  return {
    country: text(s.country),
    region: text(s.subdivision1) || text(s.region),
    city: text(s.city),
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
