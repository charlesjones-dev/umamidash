import { memoryStore, type Clock, type KeyValueStore } from '../../core/runtime.ts'
import { UmamiClient } from '../../core/umami-client.ts'
import { createStubUmami, type StubUmami } from '../stub-umami.ts'

export interface FakeClock extends Clock {
  advance(ms: number): void
  /** Every sleep, in order. */
  readonly sleeps: number[]
}

/** A clock that starts now and moves only when told to, or when slept on. */
export function fakeClock(start = Date.now()): FakeClock {
  let t = start
  const sleeps: number[] = []
  return {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms)
      t += ms
    },
    advance: (ms) => {
      t += ms
    },
    sleeps,
  }
}

export interface Harness {
  stub: StubUmami
  client: UmamiClient
  clock: FakeClock
  store: KeyValueStore
}

export function harness(): Harness {
  const stub = createStubUmami()
  const clock = fakeClock()
  const store = memoryStore()
  const client = new UmamiClient({
    transport: (path, init) => stub.handle(new Request(`https://umami.test${path}`, init)),
    username: 'stub-user',
    password: 'stub-pass',
    store,
    clock,
  })
  return { stub, client, clock, store }
}
