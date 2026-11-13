import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import loadEngine from '../engine/loader.mjs'
import { createPluginVm } from '../src'
import { ENGINE_HASHES } from '../src/engine-hashes'
import { VM_PROFILE, VM_PROFILE_HASH } from '../src/profile'

const sha256 = async (bytes: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
const ports = {
  now: () => 0,
  wait: async () => {},
  standard: () => 'null',
  sha256: async () => '',
  hmacSha256: async () => '',
}

it('locks loader and WASM bytes and has a real maximum on imported linear memory', async () => {
  await Promise.all(
    Object.entries(ENGINE_HASHES).map(async ([name, hash]) => {
      expect(
        createHash('sha256')
          .update(await readFile(new URL(`../engine/${name}`, import.meta.url)))
          .digest('hex'),
      ).toBe(hash)
    }),
  )
  const binary = await readFile(new URL('../engine/quickjs-noeval.wasm', import.meta.url))
  const module = await WebAssembly.compile(binary)
  expect(
    WebAssembly.Module.imports(module).filter((entry) => entry.kind === 'memory'),
  ).toHaveLength(1)
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 2048 })
  memory.grow(2048 - 256)
  expect(memory.buffer.byteLength).toBe(VM_PROFILE.memoryBytes)
  expect(() => memory.grow(1)).toThrow()
  // The WASM import itself rejects a memory with a larger declared maximum.
  await expect(
    loadEngine({
      wasmBinary: binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength),
      wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 4096 }),
      printErr: () => {},
    } as Parameters<typeof loadEngine>[0]),
  ).rejects.toThrow()
})

it('rejects an unknown Profile or modified engine before creating a realm', async () => {
  const resources = { wasmBinary: new ArrayBuffer(0), sha256 }
  await expect(
    createPluginVm({ profileId: 'unknown', profileHash: VM_PROFILE_HASH, resources, ports }),
  ).rejects.toThrow('profile')
  await expect(
    createPluginVm({ profileId: VM_PROFILE.id, profileHash: 'unknown', resources, ports }),
  ).rejects.toThrow('profile')
  await expect(
    createPluginVm({ profileId: VM_PROFILE.id, profileHash: VM_PROFILE_HASH, resources, ports }),
  ).rejects.toThrow('profile')
})
