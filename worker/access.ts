import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Env } from './env.ts'

// Workers with static assets don't get `ctx.access`, so the Worker checks the
// Cloudflare Access JWT itself. Access on the hostname stays the main guard.
// This check makes sure no API request gets past it by another path.

export interface AccessPolicy {
  issuer: string
  audience: string
  bypassIps: ReadonlySet<string>
}

export type AccessMode =
  | { kind: 'off' }
  | { kind: 'on'; policy: AccessPolicy }
  | { kind: 'misconfigured'; error: string }

/**
 * The check is on only when both ACCESS_AUD and ACCESS_TEAM_DOMAIN are set,
 * so a self-hosted Worker without Access isn't locked out. One without the
 * other is a mistake, and the Worker then refuses API requests.
 */
export function accessMode(env: Env): AccessMode {
  const audience = env.ACCESS_AUD?.trim()
  const team = env.ACCESS_TEAM_DOMAIN?.trim()
  if (!audience && !team) return { kind: 'off' }
  if (!audience || !team) {
    return { kind: 'misconfigured', error: 'Set both ACCESS_AUD and ACCESS_TEAM_DOMAIN, or neither' }
  }
  const host = team.replace(/^https:\/\//, '').replace(/\/+$/, '')
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) {
    return { kind: 'misconfigured', error: 'ACCESS_TEAM_DOMAIN must be a host name, such as team.cloudflareaccess.com' }
  }
  const bypassIps = new Set(
    (env.HOME_IPS ?? '')
      .split(',')
      .map((ip) => ip.trim().toLowerCase())
      .filter((ip) => ip !== ''),
  )
  return { kind: 'on', policy: { issuer: `https://${host}`, audience, bypassIps } }
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function keySet(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  let keys = keySets.get(issuer)
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
    keySets.set(issuer, keys)
  }
  return keys
}

/**
 * True when the request carries a valid Access JWT for this application, or
 * comes from an IP in HOME_IPS. Access's bypass policy sends no JWT, so the
 * Worker accepts those IPs. `CF-Connecting-IP` comes from Cloudflare, because
 * the Worker has no entry other than its route.
 */
export async function isAllowed(request: Request, policy: AccessPolicy): Promise<boolean> {
  const ip = request.headers.get('CF-Connecting-IP')?.trim().toLowerCase()
  if (ip && policy.bypassIps.has(ip)) return true

  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token) return false
  try {
    await jwtVerify(token, keySet(policy.issuer), {
      issuer: policy.issuer,
      audience: policy.audience,
      algorithms: ['RS256'],
    })
    return true
  } catch (err) {
    console.warn('Access JWT rejected:', err instanceof Error ? err.message : String(err))
    return false
  }
}
