import { describe, expect, it } from 'vitest'
import { fetchGeocodedSessions, Geocoder, memoryGeocodeCache, parseWindowMinutes } from '../../core/geocode.ts'
import { CallBudget } from '../../core/runtime.ts'
import { fakeClock, harness, type FakeClock } from './helpers.ts'

interface FakeNominatim {
  fetch: typeof fetch
  requests: { at: number; params: URLSearchParams }[]
}

function fakeNominatim(clock: FakeClock, answer: (p: URLSearchParams) => Response): FakeNominatim {
  const requests: FakeNominatim['requests'] = []
  return {
    requests,
    fetch: async (input) => {
      const params = new URL(String(input)).searchParams
      requests.push({ at: clock.now(), params })
      return answer(params)
    },
  }
}

const found = () => Response.json([{ lat: '33.75', lon: '-84.39' }])

describe('Geocoder', () => {
  it('sends at most 1 request a second, even for parallel lookups', async () => {
    const clock = fakeClock()
    const nominatim = fakeNominatim(clock, (p) => (p.has('state') ? Response.json([]) : found()))
    const geocoder = new Geocoder({ cache: memoryGeocodeCache(), clock, fetch: nominatim.fetch })
    const budget = new CallBudget(100)

    await Promise.all([
      geocoder.lookup({ country: 'US', region: 'US-GA', city: 'Atlanta' }, budget),
      geocoder.lookup({ country: 'DE', region: 'DE-BE', city: 'Berlin' }, budget),
    ])

    // Each place needs 2 queries here (the state query finds nothing).
    expect(nominatim.requests).toHaveLength(4)
    for (let i = 1; i < nominatim.requests.length; i++) {
      expect(nominatim.requests[i].at - nominatim.requests[i - 1].at).toBeGreaterThanOrEqual(1000)
    }
    expect(nominatim.requests[0].params.get('state')).toBe('GA')
  })

  it('answers repeat lookups from the cache', async () => {
    const clock = fakeClock()
    const nominatim = fakeNominatim(clock, found)
    const geocoder = new Geocoder({ cache: memoryGeocodeCache(), clock, fetch: nominatim.fetch })
    const place = { country: 'US', region: 'US-GA', city: 'Atlanta' }
    const first = await geocoder.lookup(place, new CallBudget(10))
    const second = await geocoder.lookup(place, new CallBudget(10))
    expect(second).toEqual(first)
    expect(nominatim.requests).toHaveLength(1)
  })

  it('caches "not found" only when Nominatim answered every query', async () => {
    const clock = fakeClock()
    let fail = true
    const nominatim = fakeNominatim(clock, () =>
      fail ? new Response('busy', { status: 503 }) : Response.json([]),
    )
    const geocoder = new Geocoder({ cache: memoryGeocodeCache(), clock, fetch: nominatim.fetch })
    const place = { country: 'ZZ', region: '', city: 'Nowhere' }

    expect(await geocoder.lookup(place, new CallBudget(10))).toBeNull()
    fail = false
    expect(await geocoder.lookup(place, new CallBudget(10))).toBeNull()
    const requestsSoFar = nominatim.requests.length
    expect(await geocoder.lookup(place, new CallBudget(10))).toBeNull()
    expect(nominatim.requests).toHaveLength(requestsSoFar)
  })

  it('does not cache a fallback found after a failed, more specific query', async () => {
    const clock = fakeClock()
    const nominatim = fakeNominatim(clock, (p) => (p.has('city') ? new Response('busy', { status: 503 }) : found()))
    const cache = memoryGeocodeCache()
    const geocoder = new Geocoder({ cache, clock, fetch: nominatim.fetch })
    const result = await geocoder.lookup({ country: 'US', region: 'US-GA', city: 'Atlanta' }, new CallBudget(10))
    expect(result).toEqual({ lat: 33.75, lng: -84.39 })
    expect(cache.get('US:US-GA:Atlanta')).toBeUndefined()
  })

  it('stops at the budget and caches nothing for the place it cut short', async () => {
    const clock = fakeClock()
    const nominatim = fakeNominatim(clock, () => Response.json([]))
    const cache = memoryGeocodeCache()
    const geocoder = new Geocoder({ cache, clock, fetch: nominatim.fetch })
    const result = await geocoder.lookup({ country: 'US', region: 'US-GA', city: 'Atlanta' }, new CallBudget(2))
    expect(result).toBeUndefined()
    expect(nominatim.requests).toHaveLength(2)
    expect(cache.get('US:US-GA:Atlanta')).toBeUndefined()
  })
})

describe('fetchGeocodedSessions', () => {
  it('returns the sessions it could place on the map', async () => {
    const h = harness()
    const nominatim = fakeNominatim(h.clock, found)
    const geocoder = new Geocoder({ cache: memoryGeocodeCache(), clock: h.clock, fetch: nominatim.fetch })
    const sessions = await fetchGeocodedSessions('site-1', 30, { client: h.client, geocoder, clock: h.clock })
    expect(sessions.map((s) => s.city)).toEqual(['Atlanta', 'Berlin'])
    expect(sessions[0]).toMatchObject({ region: 'US-GA', lat: 33.75, lng: -84.39, browser: 'chrome' })
    const sessionsCall = h.stub.calls.find((c) => c.endsWith('/sessions'))
    expect(sessionsCall).toBe('/api/websites/site-1/sessions')
  })
})

describe('parseWindowMinutes', () => {
  it('accepts the map windows and falls back to 5 minutes', () => {
    expect(parseWindowMinutes('10080')).toBe(10080)
    expect(parseWindowMinutes('7')).toBe(5)
    expect(parseWindowMinutes(null)).toBe(5)
  })
})
