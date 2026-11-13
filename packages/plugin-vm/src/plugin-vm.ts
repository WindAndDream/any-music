import { parseBoundedJson } from '@any-music/plugin-sdk/schema'
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core'
import type { QuickJSDeferredPromise, QuickJSHandle } from 'quickjs-emscripten-core'

import { VmError } from './contracts'
import type { StandardOperation, VmPorts, VmResources } from './contracts'
import { ENGINE_HASHES } from './engine-hashes'
import { GUEST_BOOTSTRAP } from './guest-bootstrap'
import { VM_PROFILE, VM_PROFILE_HASH, resolveVmBudget } from './profile'
import type { VmBudget } from './profile'

export interface PluginVm {
  run(
    source: string,
    inputJson?: string,
    signal?: AbortSignal,
    format?: 'body' | 'module',
  ): Promise<string>
  dispose(): void
  readonly disposed: boolean
  readonly pendingCount: number
}

export async function createPluginVm(options: {
  profileId: string
  profileHash: string
  resources: VmResources
  ports: VmPorts
  budget?: Partial<VmBudget>
}): Promise<PluginVm> {
  const { ports, resources } = options
  if (
    options.profileId !== VM_PROFILE.id ||
    options.profileHash !== VM_PROFILE_HASH ||
    (await resources.sha256(resources.wasmBinary)) !== ENGINE_HASHES['quickjs-noeval.wasm']
  )
    throw new VmError('profile')
  const budget = resolveVmBudget(options.budget)
  const memory = new WebAssembly.Memory({ initial: 256, maximum: VM_PROFILE.memoryBytes / 65536 })
  const module = await newQuickJSWASMModuleFromVariant(
    newVariant(
      {
        type: 'sync',
        importFFI: () =>
          import('@jitl/quickjs-wasmfile-release-sync/ffi').then((ffi) => ffi.QuickJSFFI),
        importModuleLoader: () => import('../engine/loader.mjs'),
      },
      { wasmBinary: resources.wasmBinary, wasmMemory: memory },
    ),
  )
  if (module.getWasmMemory() !== memory) throw new VmError('profile')
  const runtime = module.newRuntime()
  runtime.setMemoryLimit(budget.heapBytes)
  runtime.setMaxStackSize(VM_PROFILE.stackBytes)
  runtime.removeModuleLoader()
  const context = runtime.newContext()
  let disposed = false,
    busy = false,
    spentMs = 0,
    startedMs = ports.now(),
    sliceMs = startedMs
  let activeSignal: AbortSignal | undefined
  let taskAbort = new AbortController()
  const deferreds = new Set<QuickJSDeferredPromise>()
  const owned = new Set<QuickJSHandle>()
  let interruptChecks = 0
  let guestActive = false
  runtime.setInterruptHandler(
    () =>
      disposed ||
      !!activeSignal?.aborted ||
      taskAbort.signal.aborted ||
      ++interruptChecks > VM_PROFILE.interruptChecks ||
      ports.now() - startedMs >= (guestActive ? budget.deadlineMs : VM_PROFILE.deadlineMs) ||
      spentMs + ports.now() - sliceMs >=
        (guestActive ? budget.executionMs : VM_PROFILE.executionMs),
  )
  function asyncTool(work: (signal: AbortSignal) => Promise<string>): QuickJSHandle {
    if (deferreds.size >= budget.timers) throw new VmError('budget')
    const deferred = context.newPromise()
    deferreds.add(deferred)
    void Promise.resolve()
      .then(() => {
        if (disposed || taskAbort.signal.aborted) throw new VmError('cancelled')
        return work(taskAbort.signal)
      })
      .then(
        (value) => {
          if (!disposed && deferreds.has(deferred)) {
            const result = context.newString(value)
            try {
              deferred.resolve(result)
            } finally {
              result.dispose()
            }
          }
        },
        () => {
          if (!disposed && deferreds.has(deferred)) {
            const error = context.newString('Pure tool failed')
            try {
              deferred.reject(error)
            } finally {
              error.dispose()
            }
          }
        },
      )
      .finally(() => {
        if (deferreds.delete(deferred)) deferred.dispose()
      })
    return deferred.handle.dup()
  }
  function string(handle: QuickJSHandle): string {
    if (context.typeof(handle) !== 'string') throw new VmError('guest')
    const value = context.getString(handle)
    if (value.length > 65536) throw new VmError('budget')
    return value
  }
  const standard = context.newFunction('__amStandard', (operation, payload) => {
    const op = string(operation) as StandardOperation,
      input = string(payload)
    parseBoundedJson(input)
    const output = ports.standard(op, input)
    parseBoundedJson(output)
    return context.newString(output)
  })
  const delay = context.newFunction('__amDelay', (ms) => {
    if (context.typeof(ms) !== 'number') throw new VmError('guest')
    const value = context.getNumber(ms)
    if (!Number.isSafeInteger(value) || value < 0 || value > budget.deadlineMs)
      throw new VmError('budget')
    return asyncTool(async (signal) => {
      await ports.wait(value, signal)
      return ''
    })
  })
  const digest = context.newFunction('__amDigest', (input) => {
    const value = string(input)
    return asyncTool(() => ports.sha256(value))
  })
  const hmac = context.newFunction('__amHmac', (key, input) => {
    const keyValue = string(key),
      value = string(input)
    if (keyValue.length < 1 || keyValue.length > 4096) throw new VmError('budget')
    return asyncTool(() => ports.hmacSha256(keyValue, value))
  })
  for (const [name, handle] of [
    ['__amStandard', standard],
    ['__amDelay', delay],
    ['__amDigest', digest],
    ['__amHmac', hmac],
  ] as const) {
    context.setProp(context.global, name, handle)
    handle.dispose()
  }
  const boot = context.evalCode(GUEST_BOOTSTRAP, 'trusted-bootstrap.js', { type: 'global' })
  if (boot.error) {
    boot.error.dispose()
    context.dispose()
    runtime.dispose()
    throw new VmError('guest')
  }
  const encode = context.getProp(boot.value, 'encode')
  const invoke = context.getProp(boot.value, 'invoke')
  boot.value.dispose()
  function dispose() {
    if (disposed) return
    disposed = true
    taskAbort.abort()
    for (const deferred of deferreds) deferred.dispose()
    deferreds.clear()
    for (const handle of owned) if (handle.alive) handle.dispose()
    owned.clear()
    encode.dispose()
    invoke.dispose()
    context.dispose()
    runtime.dispose()
  }
  function measured<T>(action: () => T): T {
    sliceMs = ports.now()
    try {
      return action()
    } finally {
      spentMs += Math.max(0, ports.now() - sliceMs)
    }
  }
  return {
    get disposed() {
      return disposed
    },
    get pendingCount() {
      return deferreds.size
    },
    dispose,
    async run(source, inputJson = 'null', signal, format = 'body') {
      if (disposed) throw new VmError('disposed')
      if (busy) throw new VmError('busy')
      try {
        if (source.length > VM_PROFILE.messageBytes) throw new VmError('budget')
        parseBoundedJson(inputJson)
      } catch (error) {
        dispose()
        throw error
      }
      busy = true
      guestActive = true
      spentMs = 0
      interruptChecks = 0
      startedMs = ports.now()
      activeSignal = signal
      taskAbort = new AbortController()
      let result: QuickJSHandle | undefined, value: QuickJSHandle | undefined
      try {
        if (signal?.aborted) throw new VmError('cancelled')
        const evaluated = measured(() =>
          context.evalCode(
            format === 'module'
              ? source
              : `(async (input) => {\n${source}\n})(JSON.parse(${JSON.stringify(inputJson)}))`,
            'plugin.js',
            { type: format === 'module' ? 'module' : 'global' },
          ),
        )
        if (evaluated.error) {
          evaluated.error.dispose()
          throw new VmError('guest')
        }
        result = evaluated.value
        owned.add(result)
        let jobs = 0
        async function settle(handle: QuickJSHandle): Promise<QuickJSHandle> {
          while (true) {
            if (disposed) throw new VmError('disposed')
            if (signal?.aborted) throw new VmError('cancelled')
            if (
              ports.now() - startedMs >= budget.deadlineMs ||
              spentMs >= budget.executionMs ||
              jobs >= budget.maxJobs
            )
              throw new VmError('budget')
            const state = measured(() => context.getPromiseState(handle))
            if (state.type === 'fulfilled') {
              owned.add(state.value)
              return state.value
            }
            if (state.type === 'rejected') {
              state.error.dispose()
              throw new VmError('guest')
            }
            const pending = measured(() => runtime.executePendingJobs(budget.jobBatch))
            if (pending.error) {
              pending.error.dispose()
              throw new VmError('guest')
            }
            jobs += pending.value
            // Yield between bounded batches; parallel pumping would corrupt realm ownership.
            // oxlint-disable-next-line no-await-in-loop
            await ports.wait(0, taskAbort.signal)
          }
        }
        value = await settle(result)
        if (format === 'module') {
          const input = context.newString(inputJson)
          owned.add(input)
          const invocation = measured(() =>
            context.callFunction(invoke, context.undefined, value!, input),
          )
          if (invocation.error) {
            invocation.error.dispose()
            throw new VmError('guest')
          }
          owned.add(invocation.value)
          value = await settle(invocation.value)
        }
        const encoded = measured(() => context.callFunction(encode, context.undefined, value!))
        if (encoded.error) {
          encoded.error.dispose()
          throw new VmError('guest')
        }
        try {
          const output = context.getString(encoded.value)
          parseBoundedJson(output)
          return output
        } finally {
          encoded.value.dispose()
        }
      } catch (error) {
        if (signal?.aborted) throw new VmError('cancelled')
        throw error instanceof VmError ? error : new VmError('guest')
      } finally {
        for (const handle of owned) if (handle.alive) handle.dispose()
        owned.clear()
        busy = false
        // Every call is an ephemeral realm. This also drops abandoned Promise jobs and timers.
        dispose()
      }
    },
  }
}
