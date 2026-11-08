import variant from '@jitl/quickjs-wasmfile-release-sync'
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core'

/** S03 fixed diagnostic VM. It accepts no plugin source, host objects or business data. */
export async function createProbeVm(wasmBinary: ArrayBuffer) {
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 2048 })
  const module = await newQuickJSWASMModuleFromVariant(
    newVariant(variant, { wasmBinary, wasmMemory: memory }),
  )
  const runtime = module.newRuntime()
  runtime.setMemoryLimit(32 * 1024 * 1024)
  runtime.setMaxStackSize(256 * 1024)
  const deadline = Date.now() + 1000
  runtime.setInterruptHandler(() => Date.now() >= deadline)
  const context = runtime.newContext()
  return {
    memory: module.getWasmMemory(),
    runtime,
    run() {
      // This engine is a probe dependency, not the S11 no-eval production Profile.
      const result = context.evalCode(`JSON.stringify({
        noHostGlobals: ['fetch', 'WebSocket', 'document', 'indexedDB', 'localStorage',
          'BroadcastChannel', '__TAURI_INTERNALS__', 'require', 'process'].every(
            key => typeof globalThis[key] === 'undefined'),
        independentState: (globalThis.s03Counter = (globalThis.s03Counter || 0) + 1)
      })`)
      if (result.error) {
        const error = context.dump(result.error)
        result.error.dispose()
        throw new Error(`S03 VM probe failed: ${String(error)}`)
      }
      try {
        return JSON.parse(context.getString(result.value)) as {
          noHostGlobals: boolean
          independentState: number
        }
      } finally {
        result.value.dispose()
      }
    },
    dispose() {
      context.dispose()
      runtime.dispose()
    },
  }
}
