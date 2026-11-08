import { createHash, createHmac, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { setTimeout as wait } from 'node:timers/promises'

import { createPluginVm } from '@any-music/plugin-vm'
import type { PluginVm, VmPorts } from '@any-music/plugin-vm'
import { VM_PROFILE, VM_PROFILE_HASH } from '@any-music/plugin-vm/profile'
import type { VmBudget } from '@any-music/plugin-vm/profile'

/** Host fixtures are JSON. Guest assertions and imports remain inside the VM. */
export async function createTestVm(
  options: { budget?: Partial<VmBudget>; ports?: Partial<VmPorts> } = {},
): Promise<PluginVm> {
  const bytes = await readFile(
    createRequire(import.meta.url).resolve('@any-music/plugin-vm/engine.wasm'),
  )
  const ports: VmPorts = {
    now: () => performance.now(),
    wait: async (ms, signal) => {
      await wait(ms, undefined, { signal })
    },
    sha256: async (input) => createHash('sha256').update(input).digest('hex'),
    hmacSha256: async (key, input) => createHmac('sha256', key).update(input).digest('hex'),
    standard(operation, source) {
      const input = JSON.parse(source)
      switch (operation) {
        case 'url': {
          const url = new URL(input.input, input.base)
          return JSON.stringify(
            Object.fromEntries(
              [
                'href',
                'origin',
                'protocol',
                'hostname',
                'host',
                'port',
                'pathname',
                'search',
                'hash',
                'username',
                'password',
              ].map((key) => [key, url[key as keyof URL]]),
            ),
          )
        }
        case 'query':
          return JSON.stringify([...new URLSearchParams(input)])
        case 'queryString':
          return JSON.stringify(new URLSearchParams(input).toString())
        case 'encode':
          return JSON.stringify([...new TextEncoder().encode(input)])
        case 'decode':
          return JSON.stringify(
            new TextDecoder('utf-8', { fatal: input.fatal }).decode(new Uint8Array(input.bytes)),
          )
        case 'btoa':
          return JSON.stringify(btoa(input))
        case 'atob':
          return JSON.stringify(atob(input))
        case 'random': {
          if (!Number.isSafeInteger(input) || input < 0 || input > 4096)
            throw new Error('Random budget')
          return JSON.stringify([...randomBytes(input)])
        }
        case 'log':
          return 'null'
        case 'now':
          return JSON.stringify(Math.floor(ports.now()))
        default:
          throw new Error('Unknown pure tool')
      }
    },
    ...options.ports,
  }
  return createPluginVm({
    profileId: VM_PROFILE.id,
    profileHash: VM_PROFILE_HASH,
    budget: options.budget,
    ports,
    resources: {
      wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      sha256: async (value) => createHash('sha256').update(new Uint8Array(value)).digest('hex'),
    },
  })
}

export async function runGuestTest(
  source: string,
  inputJson = 'null',
  options: Parameters<typeof createTestVm>[0] = {},
) {
  const vm = await createTestVm(options)
  try {
    return JSON.parse(await vm.run(source, inputJson)) as unknown
  } finally {
    vm.dispose()
  }
}
