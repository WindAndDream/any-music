import { parseBoundedJson } from '@any-music/plugin-sdk/schema'
import { createPluginVm, VmError } from '@any-music/plugin-vm'
import type { VmPorts, VmResources } from '@any-music/plugin-vm'
import { VM_PROFILE, VM_PROFILE_HASH } from '@any-music/plugin-vm/profile'

/** A single bounded start message. There are no capability, native or cross-plugin messages. */
export async function runWorkerMessage(
  message: unknown,
  resources: VmResources,
  ports: VmPorts,
): Promise<string> {
  if (typeof message !== 'string') throw new VmError('guest')
  const input = parseBoundedJson(message) as Record<string, unknown>
  if (
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).toSorted().join(',') !==
      'format,inputJson,profileHash,profileId,source,version' ||
    input.version !== 1 ||
    input.profileId !== VM_PROFILE.id ||
    input.profileHash !== VM_PROFILE_HASH ||
    (input.format !== 'body' && input.format !== 'module') ||
    typeof input.source !== 'string' ||
    typeof input.inputJson !== 'string'
  )
    throw new VmError('profile')
  const vm = await createPluginVm({
    profileId: VM_PROFILE.id,
    profileHash: VM_PROFILE_HASH,
    resources,
    ports,
  })
  try {
    const outputJson = await vm.run(input.source, input.inputJson, undefined, input.format)
    const reply = JSON.stringify({ version: 1, outputJson })
    parseBoundedJson(reply)
    return reply
  } finally {
    vm.dispose()
  }
}
