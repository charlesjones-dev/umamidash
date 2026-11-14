import { CallBudget, isRecord, UNLIMITED, type Clock, type KeyValueStore } from './runtime.ts'

/**
 * Sends one request to Umami. `path` starts with `/api/`. Node binds it to
 * `fetch(UMAMI_API_ENDPOINT + path)`. The Worker binds it to a service
 * binding or to `fetch`.
 */
export type UmamiTransport = (path: string, init: RequestInit) => Promise<Response>

export const TOKEN_REFRESH_MS = 23 * 60 * 60 * 1000
const TOKEN_KEY = 'umami-token'
const RATE_LIMIT_RETRIES = 3

interface StoredToken {
  token: string
  issuedAt: number
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
}

/** Logs in to Umami, keeps the token fresh, and makes authenticated GETs. */
export class UmamiClient {
  #transport: UmamiTransport
  #username: string
  #password: string
  #store: KeyValueStore
  #clock: Clock
  #pendingLogin: Promise<void> | null = null

  constructor(options: UmamiClientOptions) {
    this.#transport = options.transport
    this.#username = options.username
    this.#password = options.password
    this.#store = options.store
    this.#clock = options.clock
  }

  /** True when there is no token or it is older than 23 hours. */
  needsLogin(): boolean {
    const stored = this.#store.get<StoredToken>(TOKEN_KEY)
    return !stored || this.#clock.now() - stored.issuedAt > TOKEN_REFRESH_MS
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
    const res = await this.#transport('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.#username, password: this.#password }),
    })
    if (!res.ok) {
      await discard(res)
      throw new UmamiError(`Umami login failed: ${res.status}`, res.status)
    }
    const data: unknown = await res.json()
    if (!isRecord(data) || typeof data.token !== 'string' || data.token === '') {
      throw new UmamiError('Umami login returned no token', res.status)
    }
    this.#store.put<StoredToken>(TOKEN_KEY, { token: data.token, issuedAt: this.#clock.now() })
  }

  /**
   * GETs `path` and returns the parsed JSON. Logs in again once on a 401, and
   * waits and retries up to 3 times on a 429. Every request takes from
   * `budget`, so a caller with a cap never goes past it.
   */
  async get(path: string, budget: CallBudget = new CallBudget(UNLIMITED)): Promise<unknown> {
    if (this.needsLogin()) await this.login(budget)
    let reloggedIn = false
    for (let attempt = 0; ; attempt++) {
      const token = this.#store.get<StoredToken>(TOKEN_KEY)?.token ?? ''
      budget.take()
      const res = await this.#transport(path, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) await discard(res)
      if (res.status === 401 && !reloggedIn) {
        reloggedIn = true
        // A parallel call may have logged in again already. Drop only the
        // token this call used.
        if (this.#store.get<StoredToken>(TOKEN_KEY)?.token === token) this.#store.delete(TOKEN_KEY)
        if (this.needsLogin()) await this.login(budget)
        continue
      }
      if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10)
        const seconds = retryAfter > 0 ? retryAfter : 2 ** attempt
        await this.#clock.sleep(seconds * 1000)
        continue
      }
      if (res.status === 429) throw new UmamiError(`Umami rate limited: ${path}`, 429)
      if (!res.ok) throw new UmamiError(`Umami fetch failed: ${res.status} ${path}`, res.status)
      return res.json()
    }
  }
}

/** Cancels an unread body, so the runtime can reuse the connection. */
async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel()
  } catch (err) {
    console.warn('Could not discard an Umami response body:', err)
  }
}
