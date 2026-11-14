import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, vi, type MockInstance } from 'vitest'
import type { DashboardConfig, RealtimeData } from '../../src/types/index.ts'
import { REALTIME_HEARTBEAT } from '../../src/lib/realtime-protocol.ts'
import { HUB_NAME, MAX_UMAMI_CALLS_PER_INVOCATION, type RealtimeHub } from '../../worker/hub.ts'

const ORIGIN = 'https://dash.example.test'

async function stubCalls(): Promise<string[]> {
  const res = await env.UMAMI!.fetch('https://stub/__stub/calls')
  return res.json()
}

async function resetStub(): Promise<void> {
  await env.UMAMI!.fetch('https://stub/__stub/reset')
}

/** The `tick calls=N` lines the hub logged, one per alarm, as numbers. */
function tickCalls(log: MockInstance<typeof console.log>): number[] {
  return log.mock.calls
    .map((args) => /^tick calls=(\d+)/.exec(String(args[0]))?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

interface Browser {
  socket: WebSocket
  messages: string[]
  next(): Promise<string>
  /** The next data message, skipping heartbeats. */
  nextData(): Promise<RealtimeData[]>
}

async function connect(): Promise<Browser> {
  const res = await exports.default.fetch(`${ORIGIN}/api/realtime/stream`, {
    headers: { Upgrade: 'websocket', Origin: ORIGIN },
  })
  expect(res.status).toBe(101)
  const socket = res.webSocket!
  socket.accept()
  const messages: string[] = []
  let read = 0
  let wake: (() => void) | null = null
  socket.addEventListener('message', (event) => {
    messages.push(String(event.data))
    wake?.()
  })
  const next = async (): Promise<string> => {
    const deadline = Date.now() + 3000
    while (read >= messages.length) {
      if (Date.now() > deadline) throw new Error('no message within 3 s')
      await new Promise<void>((resolve) => {
        wake = resolve
        setTimeout(resolve, 100)
      })
    }
    return messages[read++]
  }
  const nextData = async (): Promise<RealtimeData[]> => {
    for (;;) {
      const message = await next()
      if (message !== REALTIME_HEARTBEAT) return JSON.parse(message)
    }
  }
  return { socket, messages, next, nextData }
}

describe('RealtimeHub alarms with 11 sites', () => {
  // The hub's alarms run in real time here: the login at once, the first poll
  // right after it, the catch-up 1 s later, then every 15 s.
  it('never makes more than 25 calls to Umami in one alarm', async () => {
    const log = vi.spyOn(console, 'log')
    await resetStub()
    const hub = env.HUB.getByName(HUB_NAME)
    const browser = await connect()

    const first = await browser.nextData()
    expect(first).toHaveLength(11)
    const full = await browser.nextData()
    expect(full.every((site) => site.series.length === 24)).toBe(true)

    // 1 login alone, then 11 × (active + realtime) + 3 series, then the other 8 series.
    expect(tickCalls(log)).toEqual([1, MAX_UMAMI_CALLS_PER_INVOCATION, 8])
    const calls = await stubCalls()
    expect(calls).toHaveLength(1 + 25 + 8)
    expect(calls[0]).toBe('/api/auth/login')
    expect(calls.filter((c) => c.endsWith('/pageviews'))).toHaveLength(11)

    // The next alarm is a full poll interval away.
    const alarmAt = await runInDurableObject(hub, (_, state) => state.storage.getAlarm())
    expect(alarmAt! - Date.now()).toBeGreaterThan(13_000)

    // After hibernation the hub keeps its token and data: run that alarm now.
    // Nothing is due yet, so it calls nothing and sends a heartbeat.
    await evictDurableObject(hub)
    await resetStub()
    expect(await runDurableObjectAlarm(hub)).toBe(true)
    expect(await stubCalls()).toEqual([])
    expect(await browser.next()).toBe(REALTIME_HEARTBEAT)

    // A browser that connects now gets the last data at once.
    const late = await connect()
    const replay = await late.nextData()
    expect(replay).toEqual(full)

    browser.socket.close(1000, 'done')
    late.socket.close(1000, 'done')
  })

  it('stops polling when no browser is connected', async () => {
    const hub = env.HUB.getByName(HUB_NAME)
    // Run the scheduled alarm now, with every browser gone: it schedules no other.
    await until(async () => (await runInDurableObject(hub, (_, state) => state.getWebSockets().length)) === 0)
    await resetStub()
    await runDurableObjectAlarm(hub)
    expect(await stubCalls()).toEqual([])
    expect(await runInDurableObject(hub, (_, state) => state.storage.getAlarm())).toBeNull()
  })
})

describe('Worker API', () => {
  it('answers the health check and the config', async () => {
    const health = await exports.default.fetch(`${ORIGIN}/api/health`)
    expect(await health.json()).toEqual({ status: 'OK' })

    const res = await exports.default.fetch(`${ORIGIN}/api/config`)
    const config: DashboardConfig = await res.json()
    expect(config.realtimeTransport).toBe('websocket')
    expect(config.pollInterval).toBe(15000)
    expect(config.websites).toHaveLength(11)
    expect(config.umamiUrl).toBe('https://analytics.example.test')
  })

  it('refuses a WebSocket from another origin, and HEAD on the stream', async () => {
    const foreign = await exports.default.fetch(`${ORIGIN}/api/realtime/stream`, {
      headers: { Upgrade: 'websocket', Origin: 'https://evil.example.test' },
    })
    expect(foreign.status).toBe(403)
    const head = await exports.default.fetch(`${ORIGIN}/api/realtime/stream`, { method: 'HEAD' })
    expect(head.status).toBe(405)
  })

  it('refuses the sessions of a website it does not show', async () => {
    const res = await exports.default.fetch(`${ORIGIN}/api/websites/not-a-site/sessions/geo?window=30`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Website not found' })
  })

  it('answers SSE on the stream path for browsers without WebSockets', async () => {
    const controller = new AbortController()
    const res = await exports.default.fetch(`${ORIGIN}/api/realtime/stream`, { signal: controller.signal })
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toMatch(/^\n/)
    await reader.cancel()
    controller.abort()
  })
})
