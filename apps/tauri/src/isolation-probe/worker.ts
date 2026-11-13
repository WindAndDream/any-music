import wasmBase64 from 'virtual:s03-wasm'

import { createProbeVm } from './probe-vm'

// WASM bytes are bundled with the trusted bootstrap: connect-src stays 'none'.
const binary = Uint8Array.from(atob(wasmBase64), (value) => value.charCodeAt(0))
const vm = await createProbeVm(binary.buffer)
try {
  const observation = vm.run()
  // Dedicated Worker replies only to its owner; this API has no targetOrigin parameter.
  /* oxlint-disable unicorn/require-post-message-target-origin */
  globalThis.postMessage({
    worker: true,
    wasm: vm.memory instanceof WebAssembly.Memory,
    noHostGlobals: observation.noHostGlobals && observation.independentState === 1,
  })
  /* oxlint-enable unicorn/require-post-message-target-origin */
} finally {
  vm.dispose()
  // Each WebView owns exactly one Worker, module, Runtime and linear memory.
  globalThis.close()
}
