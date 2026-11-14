import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { accessMode, isAllowed, type AccessPolicy } from '../../worker/access.ts'
import type { Env } from '../../worker/env.ts'

const TEAM = 'team.cloudflareaccess.com'
const AUD = 'aud-tag-for-the-app'

function envWith(values: Partial<Env>): Env {
  return values as Env
}

function policy(homeIps = ''): AccessPolicy {
  const mode = accessMode(envWith({ ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: TEAM, HOME_IPS: homeIps }))
  if (mode.kind !== 'on') throw new Error(`expected the check on, got ${mode.kind}`)
  return mode.policy
}

async function signedToken(audience: string): Promise<string> {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const kid = crypto.randomUUID()
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256' }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    expect(String(input instanceof Request ? input.url : input)).toBe(`https://${TEAM}/cdn-cgi/access/certs`)
    return Response.json({ keys: [jwk] })
  })
  return new SignJWT({ email: 'someone@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(`https://${TEAM}`)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

function request(headers: Record<string, string>): Request {
  return new Request('https://dash.example.test/api/config', { headers })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('accessMode', () => {
  it('is off unless both the AUD and the team domain are set', () => {
    expect(accessMode(envWith({})).kind).toBe('off')
    expect(accessMode(envWith({ ACCESS_AUD: AUD })).kind).toBe('misconfigured')
    expect(accessMode(envWith({ ACCESS_TEAM_DOMAIN: TEAM })).kind).toBe('misconfigured')
    expect(accessMode(envWith({ ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: `https://${TEAM}/` })).kind).toBe('on')
  })
})

describe('isAllowed', () => {
  it('accepts a valid Access JWT for this application', async () => {
    const token = await signedToken(AUD)
    expect(await isAllowed(request({ 'Cf-Access-Jwt-Assertion': token }), policy())).toBe(true)
  })

  it('refuses a JWT for another application', async () => {
    const token = await signedToken('another-app')
    expect(await isAllowed(request({ 'Cf-Access-Jwt-Assertion': token }), policy())).toBe(false)
  })

  it('refuses a request without a JWT, unless it comes from a bypass IP', async () => {
    const p = policy(' 203.0.113.7 , 2001:DB8::1')
    expect(await isAllowed(request({ 'CF-Connecting-IP': '198.51.100.1' }), p)).toBe(false)
    expect(await isAllowed(request({ 'CF-Connecting-IP': '203.0.113.7' }), p)).toBe(true)
    expect(await isAllowed(request({ 'CF-Connecting-IP': '2001:db8::1' }), p)).toBe(true)
  })
})
