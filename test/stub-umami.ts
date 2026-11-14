// A stand-in for Umami's API, for tests and local runs. It answers the calls
// umamidash makes with made-up data and records every call.

export interface StubOptions {
  username?: string
  password?: string
  /** Delay before each answer, to measure how long a tick takes. */
  latencyMs?: number
}

export interface StubUmami {
  handle(request: Request): Promise<Response>
  /** Paths of every call so far, oldest first. */
  readonly calls: string[]
  reset(): void
  /** The next answers to GETs of data get this status. */
  failNext(status: number, times: number): void
  /** Makes the current token invalid, as a restart of Umami would. */
  revokeToken(): void
  /** Answers 401 for this website with any token, as for a website the user can't view. */
  deny(websiteId: string): void
}

export function createStubUmami(options: StubOptions = {}): StubUmami {
  const username = options.username ?? 'stub-user'
  const password = options.password ?? 'stub-pass'
  const calls: string[] = []
  let tokenSerial = 0
  let validToken = ''
  let failures: { status: number; times: number } | null = null
  const denied = new Set<string>()

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    calls.push(url.pathname)
    if (options.latencyMs) await new Promise((r) => setTimeout(r, options.latencyMs))

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const body: unknown = await request.json()
      const ok =
        typeof body === 'object' && body !== null &&
        (body as Record<string, unknown>).username === username &&
        (body as Record<string, unknown>).password === password
      if (!ok) return Response.json({ error: 'Incorrect username and/or password.' }, { status: 401 })
      validToken = `stub-token-${++tokenSerial}`
      return Response.json({ token: validToken })
    }

    if (request.headers.get('Authorization') !== `Bearer ${validToken}` || !validToken) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ([...denied].some((id) => url.pathname.includes(id))) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (failures && failures.times > 0) {
      failures.times--
      return new Response('stub failure', { status: failures.status, headers: { 'Retry-After': '1' } })
    }

    const now = Date.now()
    let m: RegExpExecArray | null
    if ((m = /^\/api\/websites\/([^/]+)\/active$/.exec(url.pathname))) {
      return Response.json({ visitors: visitorsOf(m[1]) })
    }
    if ((m = /^\/api\/realtime\/([^/]+)$/.exec(url.pathname))) {
      const n = visitorsOf(m[1])
      const events = Array.from({ length: n }, (_, i) => ({
        id: `e${i}`,
        sessionId: `s${i}`,
        createdAt: new Date(now - i * 10_000).toISOString(),
        country: i % 2 === 0 ? 'US' : 'DE',
        urlPath: i % 3 === 0 ? '/' : '/pricing',
      }))
      return Response.json({ events })
    }
    if ((m = /^\/api\/websites\/([^/]+)\/pageviews$/.exec(url.pathname))) {
      const hour = 60 * 60 * 1000
      const sessions = Array.from({ length: 24 }, (_, i) => ({
        x: new Date(Math.floor((now - i * hour) / hour) * hour).toISOString(),
        y: (i * 7 + visitorsOf(m![1])) % 13,
      }))
      return Response.json({ pageviews: [], sessions })
    }
    if ((m = /^\/api\/websites\/([^/]+)\/sessions$/.exec(url.pathname))) {
      const data = [
        { id: 'sess-1', country: 'US', subdivision1: 'US-GA', city: 'Atlanta', browser: 'chrome', os: 'Mac OS', device: 'desktop', screen: '1920x1080', language: 'en-US', firstAt: new Date(now - 60_000).toISOString(), lastAt: new Date(now).toISOString() },
        { id: 'sess-2', country: 'DE', subdivision1: 'DE-BE', city: 'Berlin', browser: 'firefox', os: 'Linux', device: 'desktop', screen: '2560x1440', language: 'de-DE', firstAt: new Date(now - 120_000).toISOString(), lastAt: new Date(now).toISOString() },
      ]
      return Response.json({ data, count: data.length, page: 1, pageSize: 200 })
    }
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  return {
    handle,
    calls,
    reset: () => {
      calls.length = 0
    },
    failNext: (status, times) => {
      failures = { status, times }
    },
    revokeToken: () => {
      validToken = ''
    },
    deny: (websiteId) => {
      denied.add(websiteId)
    },
  }
}

/** A stable small number per website, so each card shows something different. */
function visitorsOf(websiteId: string): number {
  let h = 0
  for (const c of websiteId) h = (h * 31 + c.charCodeAt(0)) % 997
  return 1 + (h % 9)
}

/** `count` websites with made-up UUIDs. */
export function stubWebsites(count: number): { id: string; name: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    name: `Site ${i + 1}`,
  }))
}
