import type { DashboardConfig, RealtimeTransport, Website } from '../src/types/index.ts'
import { isRecord } from './runtime.ts'

export const DEFAULT_POLL_INTERVAL_MS = 5000
export const MIN_POLL_INTERVAL_MS = 1000

export interface Settings {
  websites: Website[]
  columns: number
  rows: number
  pollIntervalMs: number
  /** Where the server reaches Umami. Null when a Worker uses its service binding. */
  umamiApiEndpoint: string | null
  /** Where browser links point. */
  umamiPublicUrl: string
  username: string
  password: string
  cartoApiKey: string | null
}

export type SettingsResult = { ok: true; settings: Settings } | { ok: false; errors: string[] }


/**
 * Reads and checks the environment variables both servers share. With
 * `endpointOptional`, `UMAMI_API_ENDPOINT` may be missing (a Worker with a
 * service binding), but then `UMAMI_PUBLIC_URL` is required.
 */
export function parseSettings(env: object, options: { endpointOptional?: boolean } = {}): SettingsResult {
  // Only string values count, so a Worker can pass its `env` with its bindings.
  const values = env as Readonly<Record<string, unknown>>
  const read = (name: string): string | undefined => {
    const value = values[name]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }
  const errors: string[] = []

  const endpoint = read('UMAMI_API_ENDPOINT')
  const publicUrl = read('UMAMI_PUBLIC_URL') ?? endpoint
  const username = read('UMAMI_USERNAME')
  const password = read('UMAMI_PASSWORD')
  const missing = [
    !endpoint && !options.endpointOptional ? 'UMAMI_API_ENDPOINT' : null,
    !publicUrl && options.endpointOptional ? 'UMAMI_PUBLIC_URL (or UMAMI_API_ENDPOINT)' : null,
    !username ? 'UMAMI_USERNAME' : null,
    !password ? 'UMAMI_PASSWORD' : null,
  ].filter((name) => name !== null)
  if (missing.length > 0) errors.push(`Missing required environment variables: ${missing.join(', ')}`)

  for (const [name, value] of [['UMAMI_API_ENDPOINT', endpoint], ['UMAMI_PUBLIC_URL', publicUrl]] as const) {
    if (value && !isHttpUrl(value)) errors.push(`${name} must be an http:// or https:// URL`)
  }

  const websites = parseWebsites(read('UMAMI_WEBSITES') ?? '[]')
  if (!websites) {
    errors.push('UMAMI_WEBSITES is not valid JSON. Expected: [{"id":"uuid","name":"Display Name"}]')
  }

  const columns = parseInteger(read('GRID_COLUMNS'), 3, 1, 'GRID_COLUMNS', errors)
  const rows = parseInteger(read('GRID_ROWS'), 2, 1, 'GRID_ROWS', errors)
  const pollIntervalMs = parseInteger(
    read('POLL_INTERVAL_MS'),
    DEFAULT_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
    'POLL_INTERVAL_MS',
    errors,
  )

  if (errors.length > 0 || !websites || !publicUrl || !username || !password) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    settings: {
      websites,
      columns,
      rows,
      pollIntervalMs,
      umamiApiEndpoint: endpoint ? trimSlash(endpoint) : null,
      umamiPublicUrl: trimSlash(publicUrl),
      username,
      password,
      cartoApiKey: read('CARTO_API_KEY') ?? null,
    },
  }
}

/** The body of `GET /api/config`. */
export function dashboardConfig(settings: Settings, realtimeTransport: RealtimeTransport): DashboardConfig {
  return {
    websites: settings.websites,
    columns: settings.columns,
    rows: settings.rows,
    pollInterval: settings.pollIntervalMs,
    umamiUrl: settings.umamiPublicUrl,
    cartoApiKey: settings.cartoApiKey,
    realtimeTransport,
  }
}

export function isConfiguredWebsite(settings: Settings, websiteId: string): boolean {
  return settings.websites.some((site) => site.id === websiteId)
}

function parseWebsites(json: string): Website[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    // The caller reports the invalid JSON.
    return null
  }
  if (!Array.isArray(parsed)) return null
  const websites: Website[] = []
  for (const item of parsed) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return null
    websites.push({
      id: item.id,
      name: item.name,
      ...(typeof item.domain === 'string' ? { domain: item.domain } : {}),
    })
  }
  return websites
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  name: string,
  errors: string[],
): number {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < min) {
    errors.push(`${name} must be a whole number of at least ${min}`)
    return fallback
  }
  return n
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    // Not a URL at all.
    return false
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}
