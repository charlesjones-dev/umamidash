import { describe, expect, it } from 'vitest'
import { buildHourlySeries, summarizeRealtime } from '../../core/realtime.ts'

const NOW = Date.parse('2026-11-13T15:30:00Z')
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

describe('summarizeRealtime', () => {
  it('counts unique sessions of the last 5 minutes, top 5 first', () => {
    const events = [
      { sessionId: 'a', createdAt: minutesAgo(1), country: 'US', urlPath: '/' },
      { sessionId: 'a', createdAt: minutesAgo(2), country: 'US', urlPath: '/' },
      { sessionId: 'b', createdAt: minutesAgo(3), country: 'US', urlPath: '/docs' },
      { sessionId: 'c', createdAt: minutesAgo(4), country: 'DE', urlPath: '/docs' },
      { sessionId: 'd', createdAt: minutesAgo(6), country: 'FR', urlPath: '/old' },
      ...['GB', 'JP', 'BR', 'CA', 'IN'].map((country, i) => ({
        sessionId: `x${i}`,
        createdAt: minutesAgo(1),
        country,
        urlPath: '/',
      })),
    ]
    const { countries, urls } = summarizeRealtime({ events }, NOW)
    expect(countries[0]).toEqual({ country: 'US', visitors: 2 })
    expect(countries).toHaveLength(5)
    expect(countries.some((c) => c.country === 'FR')).toBe(false)
    expect(urls).toEqual([
      { url: '/', visitors: 6 },
      { url: '/docs', visitors: 2 },
    ])
  })

  it('returns empty lists for an unexpected answer', () => {
    expect(summarizeRealtime(null, NOW)).toEqual({ countries: [], urls: [] })
    expect(summarizeRealtime({ events: 'nope' }, NOW)).toEqual({ countries: [], urls: [] })
  })
})

describe('buildHourlySeries', () => {
  it('fills 24 hours, oldest first, from either timestamp format', () => {
    const data = {
      sessions: [
        { x: '2026-11-13 15:00:00', y: 4 }, // local format, here UTC
        { x: '2026-11-13T13:00:00Z', y: 2 }, // UTC format since Umami v3.2.0
      ],
    }
    const series = buildHourlySeries(data, NOW, 'UTC')
    expect(series).toHaveLength(24)
    expect(series[23]).toEqual({ x: '2026-11-13T15:30:00.000Z', y: 4 })
    expect(series[21].y).toBe(2)
    expect(series[22].y).toBe(0)
    expect(series[0].x).toBe('2026-11-12T16:30:00.000Z')
  })

  it('keys buckets by the wall-clock hour of the time zone', () => {
    const data = { sessions: [{ x: '2026-11-13T14:00:00Z', y: 9 }] } // 09:00 in New York
    const series = buildHourlySeries(data, NOW, 'America/New_York')
    expect(series[22].y).toBe(9)
  })
})
