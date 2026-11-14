import type { CountryData, RealtimeData, SeriesPoint, UrlData, Website } from '../src/types/index.ts'
import { fetchActiveVisitors, fetchPageviewSeries, fetchRealtimeSummary } from './realtime.ts'
import {
  CallBudget,
  CallBudgetExhausted,
  errorMessage,
  type Clock,
  type KeyValueStore,
} from './runtime.ts'
import type { UmamiClient } from './umami-client.ts'

export const SERIES_INTERVAL_MS = 5 * 60 * 1000
/** Calls per site for the realtime data: the active count and the realtime events. */
export const REALTIME_CALLS_PER_SITE = 2
/** Delay before the next tick when due work didn't fit in this one. */
export const CATCH_UP_DELAY_MS = 1000
/** Timers may fire a little early. Work this close to due counts as due. */
const DUE_SLACK_MS = 500
const STATE_KEY = 'poller-state'

interface SiteState {
  /** Start of the tick that last fetched the realtime data, or 0. */
  realtimeAt: number
  /** Start of the tick that last fetched the 24-hour series, or 0. */
  seriesAt: number
  /**
   * Start of the tick that last tried the realtime data or the series, even
   * if the try failed. Due-ness counts from these, so a failing site waits a
   * full interval instead of being tried again on every catch-up tick.
   */
  realtimeTriedAt?: number
  seriesTriedAt?: number
  visitors: number
  countries: CountryData[]
  urls: UrlData[]
  series: SeriesPoint[]
}

type PollerState = Record<string, SiteState>

export interface PollerOptions {
  client: UmamiClient
  websites: Website[]
  pollIntervalMs: number
  /**
   * Most calls to Umami in one tick, retries and logins included. The
   * Worker passes 25 (a Worker invocation may make 32 service-binding calls).
   * Node passes UNLIMITED.
   */
  maxCallsPerTick: number
  /** Holds the per-site data, so a Durable Object keeps it across hibernation. */
  store: KeyValueStore
  clock: Clock
  /** Time zone for the hourly series buckets. */
  timeZone: string
  seriesIntervalMs?: number
}

export interface TickResult {
  /** Calls made to Umami in this tick. */
  calls: number
  /** True when this tick only logged in. */
  loginOnly: boolean
  /** True when the snapshot differs from the one before the tick. */
  changed: boolean
  snapshot: RealtimeData[]
  /** When the next tick should run. */
  nextDelayMs: number
  errors: string[]
}

type Job =
  | { kind: 'realtime'; site: Website }
  | { kind: 'series'; site: Website }

/**
 * Decides what to fetch from Umami on each tick, and keeps the latest data.
 *
 * Each tick logs in when the token is missing or old, and does nothing else
 * then. Otherwise it fetches, oldest first, the realtime data of every site
 * that is due (each poll interval), then the 24-hour series of every site
 * that is due (every 5 minutes), as far as `maxCallsPerTick` allows. Work
 * that didn't fit stays due, and the next tick comes after
 * `CATCH_UP_DELAY_MS` instead of a full poll interval.
 */
export class RealtimePoller {
  #options: PollerOptions
  #seriesIntervalMs: number

  constructor(options: PollerOptions) {
    this.#options = options
    this.#seriesIntervalMs = options.seriesIntervalMs ?? SERIES_INTERVAL_MS
  }

  /** The latest data for every site whose realtime data has loaded. */
  snapshot(): RealtimeData[] {
    const state = this.#load()
    const data: RealtimeData[] = []
    for (const site of this.#options.websites) {
      const s = state[site.id]
      if (!s || s.realtimeAt === 0) continue
      data.push({
        websiteId: site.id,
        visitors: s.visitors,
        countries: s.countries,
        urls: s.urls,
        series: s.series,
      })
    }
    return data
  }

  async tick(): Promise<TickResult> {
    const { client, clock, maxCallsPerTick, pollIntervalMs } = this.#options
    const now = clock.now()
    const budget = new CallBudget(maxCallsPerTick)
    const before = JSON.stringify(this.snapshot())
    const errors: string[] = []

    if (client.needsLogin()) {
      try {
        await client.login(budget)
        return this.#result(budget, true, before, 0, errors)
      } catch (err) {
        errors.push(`login: ${errorMessage(err)}`)
        return this.#result(budget, true, before, pollIntervalMs, errors)
      }
    }

    const state = this.#load()
    const { jobs, skipped } = this.#plan(state, now, maxCallsPerTick)
    let budgetSpent = skipped

    const outcomes = await Promise.allSettled(jobs.map((job) => this.#run(job, state, now, budget)))
    let tried = false
    outcomes.forEach((outcome, i) => {
      const job = jobs[i]
      // A call the budget refused was never tried: it stays due for the catch-up tick.
      if (outcome.status === 'rejected' && outcome.reason instanceof CallBudgetExhausted) {
        budgetSpent = true
        return
      }
      siteState(state, job.site.id)[job.kind === 'realtime' ? 'realtimeTriedAt' : 'seriesTriedAt'] = now
      tried = true
      if (outcome.status === 'rejected') {
        errors.push(`${job.kind} ${job.site.id}: ${errorMessage(outcome.reason)}`)
      }
    })
    if (tried) this.#options.store.put(STATE_KEY, state)

    const nextDelayMs = budgetSpent ? CATCH_UP_DELAY_MS : pollIntervalMs
    return this.#result(budget, false, before, nextDelayMs, errors)
  }

  #plan(state: PollerState, now: number, maxCalls: number): { jobs: Job[]; skipped: boolean } {
    const { websites, pollIntervalMs } = this.#options
    const triedAt = (id: string, key: 'realtimeTriedAt' | 'seriesTriedAt') => state[id]?.[key] ?? 0
    const dueBy = (key: 'realtimeTriedAt' | 'seriesTriedAt', interval: number) =>
      websites
        .filter((site) => now - triedAt(site.id, key) >= interval - DUE_SLACK_MS)
        .sort((a, b) => triedAt(a.id, key) - triedAt(b.id, key))

    const jobs: Job[] = []
    let planned = 0
    let skipped = false
    for (const site of dueBy('realtimeTriedAt', pollIntervalMs)) {
      if (planned + REALTIME_CALLS_PER_SITE > maxCalls) {
        skipped = true
        break
      }
      jobs.push({ kind: 'realtime', site })
      planned += REALTIME_CALLS_PER_SITE
    }
    for (const site of dueBy('seriesTriedAt', this.#seriesIntervalMs)) {
      if (planned + 1 > maxCalls) {
        skipped = true
        break
      }
      jobs.push({ kind: 'series', site })
      planned += 1
    }
    return { jobs, skipped }
  }

  async #run(job: Job, state: PollerState, now: number, budget: CallBudget): Promise<void> {
    const { client, timeZone } = this.#options
    const id = job.site.id
    if (job.kind === 'realtime') {
      const [visitors, summary] = await Promise.all([
        fetchActiveVisitors(client, id, budget),
        fetchRealtimeSummary(client, id, now, budget),
      ])
      const site = siteState(state, id)
      site.visitors = visitors
      site.countries = summary.countries
      site.urls = summary.urls
      site.realtimeAt = now
    } else {
      const series = await fetchPageviewSeries(client, id, now, timeZone, budget)
      const site = siteState(state, id)
      site.series = series
      site.seriesAt = now
    }
  }

  #load(): PollerState {
    return this.#options.store.get<PollerState>(STATE_KEY) ?? {}
  }

  #result(
    budget: CallBudget,
    loginOnly: boolean,
    before: string,
    nextDelayMs: number,
    errors: string[],
  ): TickResult {
    const snapshot = this.snapshot()
    return {
      calls: budget.used,
      loginOnly,
      changed: JSON.stringify(snapshot) !== before,
      snapshot,
      nextDelayMs,
      errors,
    }
  }
}

function siteState(state: PollerState, id: string): SiteState {
  state[id] ??= { realtimeAt: 0, seriesAt: 0, visitors: 0, countries: [], urls: [], series: [] }
  return state[id]
}
