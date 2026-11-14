// UmamiDash on Cloudflare Workers. Static assets serve the SPA. This Worker
// answers /api/* and hands the realtime stream and the map's sessions to the
// one RealtimeHub Durable Object, which polls Umami for every browser.
import type { ApiError, GeoSessionsResponse } from '../src/types/index.ts'
import { REALTIME_STREAM_PATH } from '../src/lib/realtime-protocol.ts'
import { dashboardConfig, isConfiguredWebsite, parseSettings, type SettingsResult } from '../core/config.ts'
import { parseWindowMinutes } from '../core/geocode.ts'
import { errorMessage } from '../core/runtime.ts'
import { accessMode, isAllowed } from './access.ts'
import type { Env } from './env.ts'
import { HUB_NAME } from './hub.ts'

export { RealtimeHub } from './hub.ts'

const GEO_PATH = /^\/api\/websites\/([^/]+)\/sessions\/geo$/

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function apiError(error: string, status: number): Response {
  return json({ error } satisfies ApiError, status)
}

function isWebSocket(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    // A malformed escape can't name a configured website.
    return null
  }
}

// The env object stays the same for the life of an isolate, so parse it once.
const settingsCache = new WeakMap<Env, SettingsResult>()

function settingsOf(env: Env): SettingsResult {
  let result = settingsCache.get(env)
  if (!result) {
    result = parseSettings(env, { endpointOptional: Boolean(env.UMAMI) })
    if (!result.ok) console.error('Invalid configuration:', result.errors.join('; '))
    else for (const warning of result.warnings) console.warn(warning)
    settingsCache.set(env, result)
  }
  return result
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    if (request.method !== 'GET' && request.method !== 'HEAD') return apiError('Not found', 404)

    const parsed = settingsOf(env)
    const access = accessMode(env)

    // Open to monitors: no Access check, and nothing private in the answer.
    if (url.pathname === '/api/health') {
      return parsed.ok && access.kind !== 'misconfigured'
        ? json({ status: 'OK' })
        : json({ status: 'ERROR', error: 'Invalid configuration' }, 503)
    }

    if (access.kind === 'misconfigured') {
      console.error('Access check:', access.error)
      return apiError('Access check is misconfigured', 503)
    }
    if (access.kind === 'on' && !(await isAllowed(request, access.policy))) {
      return apiError('Forbidden', 403)
    }

    if (!parsed.ok) return apiError('Invalid configuration', 503)
    const { settings } = parsed

    if (url.pathname === '/api/config') return json(dashboardConfig(settings, 'websocket'))

    const hub = env.HUB.getByName(HUB_NAME)

    if (url.pathname === REALTIME_STREAM_PATH) {
      // A HEAD would open an SSE stream that nobody reads.
      if (request.method !== 'GET') return apiError('Method not allowed', 405)
      // Browsers don't apply the same-origin policy to WebSockets, so any
      // page could otherwise read the stream with the viewer's access.
      const origin = request.headers.get('Origin')
      if (isWebSocket(request) && origin !== null && origin !== url.origin) {
        return apiError('Forbidden', 403)
      }
      return hub.fetch(request)
    }

    const geo = GEO_PATH.exec(url.pathname)
    if (geo) {
      const websiteId = safeDecode(geo[1])
      if (websiteId === null || !isConfiguredWebsite(settings, websiteId)) {
        return apiError('Website not found', 404)
      }
      const windowMinutes = parseWindowMinutes(url.searchParams.get('window'))
      try {
        const sessions = await hub.geoSessions(websiteId, windowMinutes)
        return json({ websiteId, sessions } satisfies GeoSessionsResponse)
      } catch (err) {
        console.error('Geo sessions error:', errorMessage(err))
        return apiError('Failed to fetch sessions', 500)
      }
    }

    return apiError('Not found', 404)
  },
} satisfies ExportedHandler<Env>
