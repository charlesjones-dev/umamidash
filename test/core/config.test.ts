import { describe, expect, it } from 'vitest'
import { dashboardConfig, parseSettings } from '../../core/config.ts'

const base = {
  UMAMI_API_ENDPOINT: 'http://umami:3000/',
  UMAMI_USERNAME: 'user',
  UMAMI_PASSWORD: 'pass',
  UMAMI_WEBSITES: '[{"id":"a","name":"A","domain":"a.example"}]',
}

describe('parseSettings', () => {
  it('applies the same defaults as server.js always had', () => {
    const result = parseSettings(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings).toMatchObject({
      columns: 3,
      rows: 2,
      pollIntervalMs: 5000,
      umamiApiEndpoint: 'http://umami:3000',
      umamiPublicUrl: 'http://umami:3000',
      cartoApiKey: null,
    })
    expect(dashboardConfig(result.settings, 'sse')).toEqual({
      websites: [{ id: 'a', name: 'A', domain: 'a.example' }],
      columns: 3,
      rows: 2,
      pollInterval: 5000,
      umamiUrl: 'http://umami:3000',
      cartoApiKey: null,
      realtimeTransport: 'sse',
    })
  })

  it('names every missing variable', () => {
    const result = parseSettings({})
    expect(result).toEqual({
      ok: false,
      errors: ['Missing required environment variables: UMAMI_API_ENDPOINT, UMAMI_USERNAME, UMAMI_PASSWORD'],
    })
  })

  it('rejects invalid websites JSON, with its own message for the wrong shape', () => {
    const invalid = parseSettings({ ...base, UMAMI_WEBSITES: '{nope' })
    expect(invalid.ok === false && invalid.errors[0]).toMatch(/not valid JSON/)
    const shape = parseSettings({ ...base, UMAMI_WEBSITES: '[{"name":"no id"}]' })
    expect(shape.ok === false && shape.errors[0]).toMatch(/string "id"/)
  })

  it('keeps accepting what server.js accepted before', () => {
    const result = parseSettings({
      ...base,
      UMAMI_PUBLIC_URL: '//analytics.example',
      UMAMI_PASSWORD: ' secret with spaces ',
      UMAMI_WEBSITES: '[{"id":"a"}]',
      GRID_COLUMNS: '3px',
      GRID_ROWS: '2.5',
      POLL_INTERVAL_MS: '500',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings).toMatchObject({
      umamiPublicUrl: '//analytics.example',
      password: ' secret with spaces ',
      websites: [{ id: 'a', name: 'a' }],
      columns: 3,
      rows: 2,
      pollIntervalMs: 1000,
    })
    expect(result.warnings).toEqual(['POLL_INTERVAL_MS=500 is below 1000; using 1000'])
  })

  it('lets a Worker with a service binding go without UMAMI_API_ENDPOINT', () => {
    const { UMAMI_API_ENDPOINT: _, ...rest } = base
    expect(parseSettings(rest, { serviceBinding: true }).ok).toBe(false)
    const result = parseSettings({ ...rest, UMAMI_PUBLIC_URL: 'https://analytics.example' }, { serviceBinding: true })
    expect(result.ok && result.settings.umamiApiEndpoint).toBeNull()
  })

  it('requires an http(s) UMAMI_PUBLIC_URL with the service binding only', () => {
    const { UMAMI_API_ENDPOINT: _, ...rest } = base
    const binding = parseSettings({ ...rest, UMAMI_PUBLIC_URL: 'analytics.example' }, { serviceBinding: true })
    expect(binding.ok === false && binding.errors[0]).toMatch(/UMAMI_PUBLIC_URL must be/)
    expect(parseSettings({ ...base, UMAMI_PUBLIC_URL: 'analytics.example' }).ok).toBe(true)
  })

  it('raises any poll interval under 1000 to 1000, and refuses text', () => {
    for (const value of ['0', '-5', '1e3']) {
      const result = parseSettings({ ...base, POLL_INTERVAL_MS: value })
      expect(result.ok && result.settings.pollIntervalMs).toBe(1000)
    }
    expect(parseSettings({ ...base, POLL_INTERVAL_MS: 'fast' }).ok).toBe(false)
  })

  it('ignores bindings and other non-string values in a Worker env', () => {
    const result = parseSettings({ ...base, HUB: {}, POLL_INTERVAL_MS: '15000' })
    expect(result.ok && result.settings.pollIntervalMs).toBe(15000)
  })
})
