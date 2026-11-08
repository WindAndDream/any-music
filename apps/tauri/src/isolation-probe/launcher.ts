import { invoke } from '@tauri-apps/api/core'

import { startProbeSession } from './probe-session'

const output = document.getElementById('result')!
// Live acceptance owns its Workers and probes through the standalone runner.
if (!(globalThis as typeof globalThis & { s03LiveAcceptance?: boolean }).s03LiveAcceptance) {
  const dispose = startProbeSession({
    createWorker: () => new Worker(new URL('/worker.js', location.href), { type: 'module' }),
    relay: (message) => invoke('plugin_probe_relay', { message }),
    userAgent: navigator.userAgent,
    report: (result) => {
      output.textContent = result
    },
  })
  addEventListener('pagehide', dispose, { once: true })
} else {
  Object.assign(globalThis, { s03Acceptance: { startProbeSession } })
}
