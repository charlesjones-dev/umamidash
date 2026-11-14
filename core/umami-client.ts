import { CallBudget, isRecord, UNLIMITED, withTimeout, type Clock, type KeyValueStore } from './runtime.ts'

/**
 * Sends one request to Umami. `path` starts with `/api/`. Node binds it to
 * `fetch(UMAMI_API_ENDPOINT + path)`. The Worker binds it to a service
 * binding or to `fetch`.
 */
export type UmamiTransport = (path: string, init: RequestInit) => Promise<Response>

export const TOKEN_REFRESH_MS = 23 * 60 * 60 * 1000
const TOKEN_KEY = 'umami-token'
/** Longest wait for one request, so one slow call can't hold a whole tick. */
export const REQUEST_TIMEOUT_MS = 10_000
/** Longest wait before a retry after a 429, whatever Retry-After says. */
const MAX_RETRY_WAIT_MS = 30_000
/**
 * A 401 on a token younger than this means the user can't see that website,
 * not that the token expired, so the client doesn't log in again for it.
 */
const FRESH_TOKEN_MS = 60_000
/** How long a path that got 401 on a fresh token triggers no other login. */
const DENIED_FOR_MS = 30 * 60_000

interface StoredToken {
  token: string
  issuedAt: number
  /** The user the token belongs to, so new credentials log in again. */
  username?: string
  /**
   * Paths (without the query) that answered 401 on a fresh token, with the
   * time: the user can't see that website. For DENIED_FOR_MS they trigger no
   * other login, so a wrong guess costs at most that long.
   */
  denied?: Record<string, number>
}

export class UmamiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'UmamiError'
    this.status = status
  }
}

export interface UmamiClientOptions {
  transport: UmamiTransport
  username: string
  password: string
  /** Holds the token, so a Durable Object keeps it across hibernation. */
  store: KeyValueStore
  clock: Clock
  /**
   * Retries after a 429, each after Retry-After (at most 30 s). The Worker
   * passes 0, so an alarm never sleeps: the site is tried on the next poll.
   */
  rateLimitRetries?: number
}

/** Logs in to Umami, keeps the token fresh, and makes authenticated GETs. */
export class UmamiClient {
  #transport: UmamiTransport
  #username: string
  #password: string
  #store: KeyValueStore
  #clock: Clock
  #rateLimitRetries: number
  #pendingLogin: Promise<void> | null = null

  constructor(options: UmamiClientOptions) {
    this.#transport = options.transport
    this.#username = options.username
    this.#password = options.password
    this.#store = options.store
    this.#clock = options.clock
    this.#rateLimitRetries = options.rateLimitRetries ?? 3
  }

  /** True when there is no token or it is older than 23 hours. */
  needsLogin(): boolean {
    const stored = this.#store.get<StoredToken>(TOKEN_KEY)
    return (
      !stored ||
      stored.username !== this.#username ||
      this.#clock.now() - stored.issuedAt > TOKEN_REFRESH_MS
    )
  }

  /** Logs in once, even when several calls ask at the same time. */
  login(budget: CallBudget = new CallBudget(UNLIMITED)): Promise<void> {
    this.#pendingLogin ??= this.#login(budget).finally(() => {
      this.#pendingLogin = null
    })
    return this.#pendingLogin
  }

  async #login(budget: CallBudget): Promise<void> {
    budget.take()
    const data = await withTimeout(REQUEST_TIMEOUT_MS, async (signal): Promise<unknown> => {
      const res = await this.#transport('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.#username, password: this.#password }),
        signal,
      })
      if (!res.ok) {
        await discard(res)
        throw new UmamiError(`Umami login failed: ${res.status}`, res.status)
      }
      return res.json()
    })
    if (!isRecord(data) || typeof data.token !== 'string' || data.token === '') {
      throw new UmamiError('Umami login returned no token', 200)
    }
    this.#store.put<StoredToken>(TOKEN_KEY, {
      token: data.token,
      issuedAt: this.#clock.now(),
      username: this.#username,
    })
  }

  /**
   * GETs `path` and returns the parsed JSON. Logs in again once on a 401 when
   * the token isn't fresh, and waits and retries on a 429 (see
   * `rateLimitRetries`). Every request takes from `budget`, so a caller with
   * a cap never goes past it.
   */
  async get(path: string, budget: CallBudget = new CallBudget(UNLIMITED)): Promise<unknown> {
    if (this.needsLogin()) await this.login(budget)
    let reloggedIn = false
    for (let attempt = 0; ; attempt++) {
      const used = this.#store.get<StoredToken>(TOKEN_KEY)
      const token = used?.token ?? ''
      budget.take()
      const { status, retryAfter, data } = await withTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
        const res = await this.#transport(path, { headers: { Authorization: `Bearer ${token}` }, signal })
        if (!res.ok) {
          await discard(res)
          return { status: res.status, retryAfter: res.headers.get('retry-after'), data: undefined }
        }
        const body: unknown = await res.json()
        return { status: res.status, retryAfter: null, data: body }
      })
      if (status === 401 && reloggedIn) this.#markDenied(path, token)
      if (status === 401 && !reloggedIn) {
        const current = this.#store.get<StoredToken>(TOKEN_KEY)
        // A parallel call logged in again already: retry with the new token.
        const replaced = current?.token !== token
        const fresh = used !== undefined && this.#clock.now() - used.issuedAt < FRESH_TOKEN_MS
        const deniedAt = used?.denied?.[pathOnly(path)]
        const denied = deniedAt !== undefined && this.#clock.now() - deniedAt < DENIED_FOR_MS
        if (replaced || (!fresh && !denied)) {
          reloggedIn = true
          if (!replaced) this.#store.delete(TOKEN_KEY)
          if (this.needsLogin()) await this.login(budget)
          continue
        }
        // A fresh token that gets 401 shows the user can't see this website.
        if (fresh) this.#markDenied(path, token)
      }
      if (status === 429 && attempt < this.#rateLimitRetries) {
        const seconds = Number.parseInt(retryAfter ?? '', 10)
        const ms = (seconds > 0 ? seconds : 2 ** attempt) * 1000
        await this.#clock.sleep(Math.min(ms, MAX_RETRY_WAIT_MS))
        continue
      }
      if (status === 429) throw new UmamiError(`Umami rate limited: ${path}`, 429)
      if (status < 200 || status >= 300) throw new UmamiError(`Umami fetch failed: ${status} ${path}`, status)
      return data
    }
  }

  /** Records that `path` is refused for the token in use, if it is still the stored one. */
  #markDenied(path: string, token: string): void {
    const stored = this.#store.get<StoredToken>(TOKEN_KEY)
    if (!stored || stored.token !== token) return
    const key = pathOnly(path)
    const deniedAt = stored.denied?.[key]
    if (deniedAt !== undefined && this.#clock.now() - deniedAt < DENIED_FOR_MS) return
    this.#store.put<StoredToken>(TOKEN_KEY, { ...stored, denied: { ...stored.denied, [key]: this.#clock.now() } })
  }
}

function pathOnly(path: string): string {
  const q = path.indexOf('?')
  return q === -1 ? path : path.slice(0, q)
}

/** Cancels an unread body, so the runtime can reuse the connection. */
async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel()
  } catch (err) {
    console.warn('Could not discard an Umami response body:', err)
  }
}
