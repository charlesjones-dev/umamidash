// What the shared module needs from its host. Node and the Worker each supply
// their own: Node keeps state in memory, the Durable Object in its storage.

export interface Clock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/**
 * A synchronous key-value store. Matches the Durable Object's
 * `ctx.storage.kv`, so the hub can pass it in as it is.
 */
export interface KeyValueStore {
  get<T>(key: string): T | undefined
  put<T>(key: string, value: T): void
  delete(key: string): boolean
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, unknown>()
  return {
    get: <T>(key: string) => map.get(key) as T | undefined,
    put: (key, value) => {
      map.set(key, value)
    },
    delete: (key) => map.delete(key),
  }
}

export class CallBudgetExhausted extends Error {
  constructor(limit: number) {
    super(`Call budget of ${limit} spent`)
    this.name = 'CallBudgetExhausted'
  }
}

/**
 * Counts outgoing calls and refuses the one past the limit. A Worker may make
 * at most 32 service-binding calls per invocation, so each alarm of the hub
 * gets one budget and every call to Umami, retries included, takes from it.
 */
export class CallBudget {
  readonly limit: number
  #used = 0

  constructor(limit: number) {
    this.limit = limit
  }

  get used(): number {
    return this.#used
  }

  get remaining(): number {
    return this.limit - this.#used
  }

  take(): void {
    if (this.#used >= this.limit) throw new CallBudgetExhausted(this.limit)
    this.#used++
  }
}

export const UNLIMITED = Number.POSITIVE_INFINITY

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Runs `run` with a signal that aborts after `ms`, and clears the timer as
 * soon as `run` settles. Not `AbortSignal.timeout()`: its timer stays pending
 * after the request is done, and in a Durable Object a pending timer stops
 * hibernation.
 */
export async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${ms} ms`)), ms)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}
