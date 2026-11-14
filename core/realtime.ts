import type { CountryData, SeriesPoint, UrlData } from '../src/types/index.ts'
import { isRecord, type CallBudget } from './runtime.ts'
import type { UmamiClient } from './umami-client.ts'

/** Umami's active-visitor window, which the realtime lists match. */
export const ACTIVE_WINDOW_MS = 5 * 60 * 1000
const TOP_ITEMS = 5
const HOUR_MS = 60 * 60 * 1000

export interface RealtimeSummary {
  countries: CountryData[]
  urls: UrlData[]
}

export async function fetchActiveVisitors(
  client: UmamiClient,
  websiteId: string,
  budget?: CallBudget,
): Promise<number> {
  const data = await client.get(`/api/websites/${encodeURIComponent(websiteId)}/active`, budget)
  return isRecord(data) && typeof data.visitors === 'number' ? data.visitors : 0
}

export async function fetchRealtimeSummary(
  client: UmamiClient,
  websiteId: string,
  now: number,
  budget?: CallBudget,
): Promise<RealtimeSummary> {
  const data = await client.get(`/api/realtime/${encodeURIComponent(websiteId)}`, budget)
  return summarizeRealtime(data, now)
}

/**
 * Top 5 countries and URLs by unique sessions, from the pageviews of the last
 * 5 minutes, so the lists match the active-visitor count.
 */
export function summarizeRealtime(data: unknown, now: number): RealtimeSummary {
  const events = isRecord(data) && Array.isArray(data.events) ? data.events : []
  const since = now - ACTIVE_WINDOW_MS
  const countrySessions = new Map<string, Set<string>>()
  const urlSessions = new Map<string, Set<string>>()

  for (const event of events) {
    if (!isRecord(event)) continue
    const createdAt = typeof event.createdAt === 'string' ? Date.parse(event.createdAt) : Number.NaN
    if (!(createdAt >= since)) continue
    const session = String(event.sessionId ?? event.id ?? '')
    if (typeof event.country === 'string' && event.country) {
      addTo(countrySessions, event.country, session)
    }
    if (typeof event.urlPath === 'string' && event.urlPath) {
      addTo(urlSessions, event.urlPath, session)
    }
  }

  return {
    countries: top(countrySessions).map(([country, visitors]) => ({ country, visitors })),
    urls: top(urlSessions).map(([url, visitors]) => ({ url, visitors })),
  }
}

function addTo(map: Map<string, Set<string>>, key: string, session: string): void {
  let sessions = map.get(key)
  if (!sessions) {
    sessions = new Set()
    map.set(key, sessions)
  }
  sessions.add(session)
}

function top(map: Map<string, Set<string>>): [string, number][] {
  return [...map]
    .map(([key, sessions]): [string, number] => [key, sessions.size])
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_ITEMS)
}

export async function fetchPageviewSeries(
  client: UmamiClient,
  websiteId: string,
  now: number,
  timeZone: string,
  budget?: CallBudget,
): Promise<SeriesPoint[]> {
  const params = new URLSearchParams({
    startAt: String(now - 24 * HOUR_MS),
    endAt: String(now),
    unit: 'hour',
    timezone: timeZone,
  })
  const data = await client.get(
    `/api/websites/${encodeURIComponent(websiteId)}/pageviews?${params}`,
    budget,
  )
  return buildHourlySeries(data, now, timeZone)
}

/**
 * Sessions per hour for the last 24 hours, oldest first, with empty hours as 0.
 *
 * Umami's bucket timestamps vary by version and server time zone:
 * "2026-02-18 20:00:00" (local) or "2026-02-18T20:00:00Z" (UTC, since v3.2.0
 * when the requested time zone resolves to UTC). Each bucket is parsed into
 * an instant and keyed by its wall-clock hour, so both formats match.
 */
export function buildHourlySeries(data: unknown, now: number, timeZone: string): SeriesPoint[] {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  })
  const hourKey = (date: Date): string => {
    const parts = fmt.formatToParts(date)
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}`
  }

  const sparse = new Map<string, number>()
  const buckets = isRecord(data) && Array.isArray(data.sessions) ? data.sessions : []
  for (const bucket of buckets) {
    if (!isRecord(bucket) || typeof bucket.y !== 'number') continue
    const date = new Date(typeof bucket.x === 'string' ? bucket.x : Number.NaN)
    if (Number.isNaN(date.getTime())) continue
    sparse.set(hourKey(date), bucket.y)
  }

  const series: SeriesPoint[] = []
  for (let i = 23; i >= 0; i--) {
    const t = new Date(now - i * HOUR_MS)
    series.push({ x: t.toISOString(), y: sparse.get(hourKey(t)) ?? 0 })
  }
  return series
}
