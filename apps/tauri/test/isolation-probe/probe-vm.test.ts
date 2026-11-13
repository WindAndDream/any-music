import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { createProbeVm } from '../../src/isolation-probe/probe-vm'

describe('S03 fixed diagnostic VM', () => {
  it('creates distinct WASM memories and runtimes without host globals or shared guest state', async () => {
    const require = createRequire(import.meta.url)
    const bytes = readFileSync(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'))
    const binary = Uint8Array.from(bytes).buffer
    const a = await createProbeVm(binary)
    const b = await createProbeVm(binary)
    try {
      expect(a.memory).not.toBe(b.memory)
      expect(a.memory.buffer).not.toBe(b.memory.buffer)
      expect(a.runtime).not.toBe(b.runtime)
      expect(a.run()).toEqual({ noHostGlobals: true, independentState: 1 })
      expect(a.run()).toEqual({ noHostGlobals: true, independentState: 2 })
      expect(b.run()).toEqual({ noHostGlobals: true, independentState: 1 })
      // The maximum supplied to each separate WASM memory is 128 MiB.
      expect(() => a.memory.grow(2049)).toThrow()
    } finally {
      a.dispose()
      b.dispose()
    }
  })
})
