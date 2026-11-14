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

export type SettingsResult =
  | { ok: true; settings: Settings; warnings: string[] }
  | { ok: false; errors: string[] }

/**
 * Reads and checks the environment variables both servers share. It accepts
 * what server.js always accepted (numbers read with parseInt, any public
 * URL), and refuses only values that can never work. With
 * `endpointOptional`, `UMAMI_API_ENDPOINT` may be missing (a Worker with a
 * service binding), but then `UMAMI_PUBLIC_URL` is required.
 */
export function parseSettings(env: object, options: { endpointOptional?: boolean } = {}): SettingsResult {
  // Only string values count, so a Worker can pass its `env` with its bindings.
  const values = env as Readonly<Record<string, unknown>>
  const raw = (name: string): string | undefined => {
    const value = values[name]
    return typeof value === 'string' && value.trim() !== '' ? value : undefined
  }
  const read = (name: string): string | undefined => raw(name)?.trim()
  const errors: string[] = []
  const warnings: string[] = []

  const endpoint = read('UMAMI_API_ENDPOINT')
  const publicUrl = read('UMAMI_PUBLIC_URL') ?? endpoint
  // Credentials are used exactly as given: a space can be part of a password.
  const username = raw('UMAMI_USERNAME')
  const password = raw('UMAMI_PASSWORD')
  const missing = [
    !endpoint && !options.endpointOptional ? 'UMAMI_API_ENDPOINT' : null,
    !publicUrl && options.endpointOptional ? 'UMAMI_PUBLIC_URL (or UMAMI_API_ENDPOINT)' : null,
    !username ? 'UMAMI_USERNAME' : null,
    !password ? 'UMAMI_PASSWORD' : null,
  ].filter((name) => name !== null)
  if (missing.length > 0) errors.push(`Missing required environment variables: ${missing.join(', ')}`)
  if (endpoint && !isHttpUrl(endpoint)) errors.push('UMAMI_API_ENDPOINT must be an http:// or https:// URL')

  const websites = parseWebsites(read('UMAMI_WEBSITES') ?? '[]', errors)

  const columns = parseInteger(read('GRID_COLUMNS'), 3, 'GRID_COLUMNS', errors)
  const rows = parseInteger(read('GRID_ROWS'), 2, 'GRID_ROWS', errors)
  let pollIntervalMs = parseInteger(read('POLL_INTERVAL_MS'), DEFAULT_POLL_INTERVAL_MS, 'POLL_INTERVAL_MS', errors)
  if (pollIntervalMs < MIN_POLL_INTERVAL_MS) {
    warnings.push(`POLL_INTERVAL_MS=${pollIntervalMs} is below ${MIN_POLL_INTERVAL_MS}; using ${MIN_POLL_INTERVAL_MS}`)
    pollIntervalMs = MIN_POLL_INTERVAL_MS
  }

  if (errors.length > 0 || !websites || !publicUrl || !username || !password) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    warnings,
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

const WEBSITES_FORMAT = 'Expected: [{"id":"uuid","name":"Display Name"}]'

function parseWebsites(json: string, errors: string[]): Website[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    errors.push(`UMAMI_WEBSITES is not valid JSON. ${WEBSITES_FORMAT}`)
    return null
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => isRecord(item) && typeof item.id === 'string')) {
    errors.push(`UMAMI_WEBSITES must be a JSON array of objects, each with a string "id". ${WEBSITES_FORMAT}`)
    return null
  }
  return parsed.filter(isRecord).map((item) => ({
    id: String(item.id),
    // A website without a name shows its ID.
    name: typeof item.name === 'string' ? item.name : String(item.id),
    ...(typeof item.domain === 'string' ? { domain: item.domain } : {}),
  }))
}

/** Reads a whole number the way server.js always did: parseInt, so "3px" is 3. */
function parseInteger(value: string | undefined, fallback: number, name: string, errors: string[]): number {
  if (value === undefined) return fallback
  const n = Number.parseInt(value, 10)
  if (!(n >= 1)) {
    errors.push(`${name} must be a whole number of at least 1`)
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
