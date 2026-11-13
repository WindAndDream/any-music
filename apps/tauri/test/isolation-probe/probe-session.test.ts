import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startProbeSession } from '../../src/isolation-probe/probe-session'

const observation = { worker: true, wasm: true, noHostGlobals: true }
const ack = { sequence: 0, codePluginsEnabled: false }

class TestWorker extends EventTarget {
  terminate = vi.fn()

  emit(value: unknown = observation) {
    this.dispatchEvent(new MessageEvent('message', { data: value }))
  }
}

function pendingRelay() {
  let resolve!: (value: unknown) => void
  let reject!: (reason: Error) => void
  const result = new Promise<unknown>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { relay: vi.fn(() => result), resolve, reject }
}

function setup(relay: (message: string) => Promise<unknown> = vi.fn().mockResolvedValue(ack)) {
  const worker = new TestWorker()
  const report = vi.fn()
  const dispose = startProbeSession({ createWorker: () => worker, relay, report })
  return { worker, report, dispose, relay }
}

describe('S03 diagnostic exchange lifecycle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('relays one bounded observation and never treats its ACK as target acceptance', async () => {
    const { worker, relay, report, dispose } = setup()
    worker.emit()
    worker.emit()
    await vi.advanceTimersByTimeAsync(0)
    expect(relay).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ epoch: 1, sequence: 0, observation }),
    )
    expect(report).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ observation, ack }))
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    dispose()
    worker.dispatchEvent(new Event('error'))
    expect(report).toHaveBeenCalledTimes(1)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('times out VM startup, terminates the worker and ignores late messages', async () => {
    const { worker, relay, report } = setup()
    await vi.advanceTimersByTimeAsync(5000)
    worker.emit()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(relay).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledExactlyOnceWith('Probe timed out. Code plugins remain disabled.')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['resolve', 'reject'] as const)(
    'bounds a stuck relay and ignores its late %s',
    async (action) => {
      const pending = pendingRelay()
      const { worker, report } = setup(pending.relay)
      await vi.advanceTimersByTimeAsync(4000)
      worker.emit()
      // The deadline belongs to the entire exchange; a Worker reply does not reset it.
      await vi.advanceTimersByTimeAsync(1000)
      expect(report).toHaveBeenCalledExactlyOnceWith(
        'Probe timed out. Code plugins remain disabled.',
      )
      if (action === 'resolve') pending.resolve(ack)
      else pending.reject(new Error('late rejection'))
      await vi.advanceTimersByTimeAsync(0)
      expect(report).toHaveBeenCalledTimes(1)
      expect(worker.terminate).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['resolve', 'reject'] as const)(
    'ignores a late %s after the owner unloads',
    async (action) => {
      const pending = pendingRelay()
      const { worker, report, dispose } = setup(pending.relay)
      worker.emit()
      dispose()
      dispose()
      if (action === 'resolve') pending.resolve(ack)
      else pending.reject(new Error('page gone'))
      await vi.advanceTimersByTimeAsync(5000)
      expect(report).not.toHaveBeenCalled()
      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('disposes an owner before any reply without invoking the relay', async () => {
    const { worker, relay, report, dispose } = setup()
    dispose()
    worker.emit()
    await vi.advanceTimersByTimeAsync(5000)
    expect(relay).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['error', 'messageerror'])('cleans up on Worker %s', async (type) => {
    const { worker, relay, report } = setup()
    worker.dispatchEvent(new Event(type))
    worker.emit()
    await vi.advanceTimersByTimeAsync(5000)
    expect(report).toHaveBeenCalledExactlyOnceWith(
      'Worker/WASM unavailable. Code plugins remain disabled.',
    )
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(relay).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports Worker construction failure without leaving a watchdog', () => {
    const report = vi.fn()
    const relay = vi.fn()
    const dispose = startProbeSession({
      createWorker: () => {
        throw new Error('Worker unavailable')
      },
      relay,
      report,
    })
    dispose()
    expect(report).toHaveBeenCalledExactlyOnceWith(
      'Worker/WASM unavailable. Code plugins remain disabled.',
    )
    expect(relay).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    null,
    [],
    {},
    { ...observation, wasm: 'true' },
    { ...observation, userConfirmed: true },
    { ...observation, payload: 'x'.repeat(4096) },
  ])('rejects invalid Worker observations before IPC (case %#)', (value) => {
    const { worker, relay, report } = setup()
    worker.emit(value)
    expect(relay).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledExactlyOnceWith('Probe rejected. Code plugins remain disabled.')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    null,
    { ...ack, codePluginsEnabled: true },
    { ...ack, sequence: 1 },
    { ...ack, userConfirmed: true },
  ])('rejects invalid ACKs: %j', async (value) => {
    const { worker, report } = setup(vi.fn().mockResolvedValue(value))
    worker.emit()
    await vi.advanceTimersByTimeAsync(0)
    expect(report).toHaveBeenCalledExactlyOnceWith('Probe rejected. Code plugins remain disabled.')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('contains relay failures, including synchronous bridge errors', async () => {
    for (const relay of [
      vi.fn().mockRejectedValue(new Error('native rejection')),
      () => {
        throw new Error('bridge unavailable')
      },
    ]) {
      const { worker, report } = setup(relay)
      worker.emit()
      // Drain this case's fake timers before reusing the timer clock for the next failure.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await vi.advanceTimersByTimeAsync(0)
      expect(report).toHaveBeenCalledExactlyOnceWith(
        'Probe rejected. Code plugins remain disabled.',
      )
      expect(vi.getTimerCount()).toBe(0)
    }
  })
})
