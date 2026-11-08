import type { RoutingClock } from '../../src/index'

/** Deterministic monotonic time: no real waits or public-network timing assertions. */
export class ManualClock implements RoutingClock {
  private time = 0
  private sequence = 0
  private readonly timers = new Map<number, { at: number; callback: () => void }>()
  now(): number {
    return this.time
  }
  schedule(delayMs: number, callback: () => void): () => void {
    const id = ++this.sequence
    this.timers.set(id, { at: this.time + delayMs, callback })
    return () => {
      this.timers.delete(id)
    }
  }
  advance(delayMs: number): void {
    const end = this.time + delayMs
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .toSorted((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!next) break
      this.time = next[1].at
      this.timers.delete(next[0])
      next[1].callback()
    }
    this.time = end
  }
  get pending(): number {
    return this.timers.size
  }
}

export function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export async function flush(): Promise<void> {
  // eslint-disable-next-line no-await-in-loop -- Nested executors release leases over sequential microtasks.
  for (let index = 0; index < 16; index++) await Promise.resolve()
}
