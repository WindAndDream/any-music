/** Structural compatibility with core's cancellation port without importing music contracts. */
export interface RoutingCancellation {
  isCancelled(): boolean
  subscribe(listener: () => void): () => void
}

/** One attempt owns its source; consumers receive only the read-only signal. */
export class CancellationSource {
  private cancelled = false
  private readonly listeners = new Set<() => void>()
  readonly signal: RoutingCancellation = {
    isCancelled: () => this.cancelled,
    subscribe: (listener) => {
      if (this.cancelled) {
        notify(listener)
        return () => {}
      }
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    const listeners = [...this.listeners]
    this.listeners.clear()
    // One broken transport abort callback must not prevent the other transports from stopping.
    for (const listener of listeners) notify(listener)
  }
}

function notify(listener: () => void): void {
  try {
    listener()
  } catch {
    // Cancellation is best effort at the transport boundary; the executor independently settles.
  }
}
