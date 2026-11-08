import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

import { VM_PROFILE } from '@any-music/plugin-vm/profile'
import { expect, it } from 'vitest'

import { runWorkerMessage } from '../src/worker-runtime'

it('bounds raw input before engine allocation, rejecting malformed and spoofed protocol messages', async () => {
  const bytes = await readFile(
    createRequire(import.meta.url).resolve('@any-music/plugin-vm/engine.wasm'),
  )
  let loads = 0
  const resources = {
    wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    sha256: async (value: ArrayBuffer) => {
      loads++
      return createHash('sha256').update(new Uint8Array(value)).digest('hex')
    },
  }
  const ports = {
    now: () => 0,
    wait: async () => {},
    standard: () => 'null',
    sha256: async () => '',
    hmacSha256: async () => '',
  }
  const messages: unknown[] = [
    null,
    {},
    'null',
    '[]',
    '{bad}',
    '{"version":1,"version":1}',
    JSON.stringify({ version: 1, profileId: 'unknown', source: 'return 1;', inputJson: 'null' }),
    JSON.stringify({
      version: 1,
      profileId: VM_PROFILE.id,
      source: 'return 1;',
      inputJson: 'null',
      pluginId: 'spoofed',
    }),
    '"' + 'x'.repeat(262145) + '"',
  ]
  // Fixed pseudo-random malformed bytes exercise the parser without interpreting project hooks.
  for (let seed = 0; seed < 128; seed++) messages.push(String.fromCharCode(seed) + '{"version":1}')
  for (const message of messages) {
    // Sequential inputs prove each rejected message allocates no engine.
    // oxlint-disable-next-line no-await-in-loop
    await expect(runWorkerMessage(message, resources, ports)).rejects.toThrow()
  }
  expect(loads).toBe(0)
})
