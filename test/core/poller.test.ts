import { describe, expect, it } from 'vitest'
import { CATCH_UP_DELAY_MS, RealtimePoller } from '../../core/poller.ts'
import { UNLIMITED } from '../../core/runtime.ts'
import { TOKEN_REFRESH_MS } from '../../core/umami-client.ts'
import { stubWebsites } from '../stub-umami.ts'
import { harness, type Harness } from './helpers.ts'

const POLL_MS = 15_000
const CAP = 25

function poller(h: Harness, sites: number, maxCallsPerTick = CAP): RealtimePoller {
  return new RealtimePoller({
    client: h.client,
    websites: stubWebsites(sites),
    pollIntervalMs: POLL_MS,
    maxCallsPerTick,
    store: h.store,
    clock: h.clock,
    timeZone: 'UTC',
  })
}

/** Runs a tick and returns how many calls reached the stub during it. */
async function tick(h: Harness, p: RealtimePoller) {
  h.stub.reset()
  const result = await p.tick()
  expect(result.calls).toBe(h.stub.calls.length)
  return result
}

describe('RealtimePoller with a cap of 25 calls per tick', () => {
  it('loads 11 sites in batches without passing 25 calls in any tick', async () => {
    const h = harness()
    const p = poller(h, 11)

    const login = await tick(h, p)
    expect(login.loginOnly).toBe(true)
    expect(h.stub.calls).toEqual(['/api/auth/login'])
    expect(login.nextDelayMs).toBe(0)

    const first = await tick(h, p)
    expect(first.calls).toBe(25) // 11 × (active + realtime) + 3 series
    expect(h.stub.calls.filter((c) => c.endsWith('/pageviews'))).toHaveLength(3)
    expect(first.snapshot).toHaveLength(11)
    expect(first.changed).toBe(true)
    expect(first.nextDelayMs).toBe(CATCH_UP_DELAY_MS)

    h.clock.advance(CATCH_UP_DELAY_MS)
    const catchUp = await tick(h, p)
    expect(catchUp.calls).toBe(8) // the other series only: realtime isn't due yet
    expect(h.stub.calls.every((c) => c.endsWith('/pageviews'))).toBe(true)
    expect(catchUp.nextDelayMs).toBe(POLL_MS)
    expect(catchUp.snapshot.every((site) => site.series.length === 24)).toBe(true)

    h.clock.advance(POLL_MS)
    const steady = await tick(h, p)
    expect(steady.calls).toBe(22)
    expect(steady.changed).toBe(false)
    expect(steady.nextDelayMs).toBe(POLL_MS)
  })

  it('refreshes the series every 5 minutes inside the cap', async () => {
    const h = harness()
    const p = poller(h, 11)
    await tick(h, p)
    await tick(h, p)
    h.clock.advance(CATCH_UP_DELAY_MS)
    await tick(h, p)

    for (let elapsed = 0; elapsed < 5 * 60_000; elapsed += POLL_MS) {
      h.clock.advance(POLL_MS)
      const result = await tick(h, p)
      expect(result.calls).toBeLessThanOrEqual(CAP)
    }
    const seriesCalls: number[] = []
    for (let i = 0; i < 4; i++) {
      h.clock.advance(CATCH_UP_DELAY_MS)
      const result = await tick(h, p)
      expect(result.calls).toBeLessThanOrEqual(CAP)
      seriesCalls.push(h.stub.calls.filter((c) => c.endsWith('/pageviews')).length)
    }
    expect(seriesCalls.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(8)
  })

  it('splits the realtime polls of 30 sites over two ticks', async () => {
    const h = harness()
    const p = poller(h, 30)
    await tick(h, p)

    const first = await tick(h, p)
    expect(first.calls).toBe(25) // 12 × (active + realtime) + 1 series
    expect(first.snapshot).toHaveLength(12)
    expect(first.nextDelayMs).toBe(CATCH_UP_DELAY_MS)

    let ticks = 0
    let last = first
    while (last.nextDelayMs === CATCH_UP_DELAY_MS && ticks < 10) {
      h.clock.advance(CATCH_UP_DELAY_MS)
      last = await tick(h, p)
      expect(last.calls).toBeLessThanOrEqual(CAP)
      ticks++
    }
    expect(last.snapshot).toHaveLength(30)
    expect(last.snapshot.every((site) => site.series.length === 24)).toBe(true)
  })

  it('logs in again on its own tick after 23 hours', async () => {
    const h = harness()
    const p = poller(h, 11)
    await tick(h, p)
    await tick(h, p)
    h.clock.advance(TOKEN_REFRESH_MS + 1)
    const relogin = await tick(h, p)
    expect(relogin.loginOnly).toBe(true)
    expect(h.stub.calls).toEqual(['/api/auth/login'])
  })

  it('stays inside the cap when Umami drops the token mid-tick', async () => {
    const h = harness()
    const p = poller(h, 11)
    await tick(h, p)
    await tick(h, p)
    h.clock.advance(CATCH_UP_DELAY_MS)
    await tick(h, p)

    h.clock.advance(2 * 60_000) // the token is no longer fresh, as after an Umami restart
    h.stub.revokeToken()
    const dropped = await tick(h, p)
    expect(dropped.calls).toBeLessThanOrEqual(CAP)
    expect(dropped.nextDelayMs).toBe(CATCH_UP_DELAY_MS)

    // Whatever didn't fit is fetched on the following ticks, never past the cap.
    let last = dropped
    for (let i = 0; i < 3 && last.nextDelayMs === CATCH_UP_DELAY_MS; i++) {
      h.clock.advance(CATCH_UP_DELAY_MS)
      last = await tick(h, p)
      expect(last.calls).toBeLessThanOrEqual(CAP)
    }
    expect(last.nextDelayMs).toBe(POLL_MS)
    expect(last.errors).toEqual([])
  })

  it('keeps the last data of a site whose poll fails, and reports the error', async () => {
    const h = harness()
    const p = poller(h, 2)
    await tick(h, p)
    const ok = await tick(h, p)
    h.clock.advance(POLL_MS)
    h.stub.failNext(500, 1)
    const failed = await tick(h, p)
    expect(failed.errors).toHaveLength(1)
    expect(failed.snapshot).toEqual(ok.snapshot)
    expect(failed.nextDelayMs).toBe(POLL_MS)
  })

  it('waits a full interval after failures instead of catching up every second', async () => {
    const h = harness()
    const p = poller(h, 11)
    await tick(h, p)
    h.stub.failNext(500, 1000) // Umami fails every data call from now on

    const first = await tick(h, p)
    expect(first.calls).toBe(25)
    expect(first.nextDelayMs).toBe(CATCH_UP_DELAY_MS) // 8 series never tried

    h.clock.advance(CATCH_UP_DELAY_MS)
    const second = await tick(h, p)
    expect(second.calls).toBe(8) // only the series not yet tried
    expect(second.nextDelayMs).toBe(POLL_MS)

    h.clock.advance(CATCH_UP_DELAY_MS)
    const early = await tick(h, p)
    expect(early.calls).toBe(0) // nothing failed is due again before the interval
    expect(early.snapshot).toEqual([])
  })

  it('does not log in again for a 401 on a fresh token', async () => {
    const h = harness()
    const p = poller(h, 11)
    await tick(h, p)
    h.stub.revokeToken() // every data call now answers 401, seconds after the login
    const result = await tick(h, p)
    expect(h.stub.calls).not.toContain('/api/auth/login')
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.calls).toBeLessThanOrEqual(CAP)
  })

  it('waits and retries on a 429, inside the cap', async () => {
    const h = harness()
    const p = poller(h, 1)
    await tick(h, p)
    h.stub.failNext(429, 2)
    const result = await tick(h, p)
    expect(result.errors).toEqual([])
    expect(h.clock.sleeps).toEqual([1000, 1000]) // Retry-After: 1
  })
})

describe('RealtimePoller without a cap (Node)', () => {
  it('fetches every site and every series in one tick, as server.js did', async () => {
    const h = harness()
    const p = poller(h, 11, UNLIMITED)
    await tick(h, p)
    const first = await tick(h, p)
    expect(first.calls).toBe(33)
    expect(first.nextDelayMs).toBe(POLL_MS)
  })
})
