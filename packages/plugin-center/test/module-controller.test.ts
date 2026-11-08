import { describe, expect, it, vi } from 'vitest'

import { ModuleController, createModuleRecovery } from '../src/index'
import type { ModuleInstance } from '../src/index'
import { context, contribution, deferred, moduleFixture, points } from './module-fixtures'

describe('module lifecycle controller', () => {
  it('keeps build-blocked modules inactive across startup, enablement and replacement', async () => {
    const blocked = moduleFixture('blocked', { unavailableReason: '功能正在开发中。' })
    const activate = vi.fn(blocked.activate)
    const controller = new ModuleController({
      builtIns: [{ ...blocked, activate }],
      points,
      readCommandContext: () => context,
    })
    await controller.start()
    expect(controller.states.get('blocked')?.enabled).toBe(false)
    expect(controller.preview({ context }).slots['workspace.views']).toEqual([])
    expect(() => controller.setEnabled('blocked', true)).toThrow('module-unavailable')
    await expect(controller.activate(['blocked'])).rejects.toThrow()
    expect(activate).not.toHaveBeenCalled()
    await controller.replaceBuiltIn(moduleFixture('blocked'))
    await controller.setEnabled('blocked', true)
    await controller.activate(['blocked'])
    await controller.replaceBuiltIn({ ...blocked, activate })
    expect(controller.states.get('blocked')?.enabled).toBe(false)
    await expect(controller.activate(['blocked'])).rejects.toThrow()
    expect(activate).not.toHaveBeenCalled()
    await controller.dispose()
  })
  it('releases every staged owner when an unrelated lifecycle change cancels an incomplete batch', async () => {
    const started = deferred<void>()
    const pending = deferred<ModuleInstance>()
    const released: string[] = []
    const provider = moduleFixture('provider', { provides: [{ id: 'service', version: 1 }] })
    const consumer = moduleFixture('consumer', { requires: [{ id: 'service', version: 1 }] })
    provider.activate = (scope) => {
      scope.defer(() => {
        released.push('provider')
      })
      return { contributionIds: ['view'] }
    }
    consumer.activate = (scope) => {
      scope.defer(() => {
        released.push('consumer')
      })
      started.resolve()
      return pending.promise
    }
    const controller = new ModuleController({
      builtIns: [provider, consumer, moduleFixture('unrelated')],
      points,
      readCommandContext: () => context,
    })
    const rejected = expect(controller.activate(['consumer'])).rejects.toThrow('stale-activation')
    await started.promise
    await controller.setEnabled('unrelated', false)
    await rejected
    expect(released).toEqual(['consumer', 'provider'])
    expect(controller.allocation.slots['workspace.views']).toEqual([])
    pending.resolve({ contributionIds: ['view'] })
  })
  it('invalidates in-flight command results and activation scopes after disable', async () => {
    const result = deferred<string>()
    const entered = deferred<void>()
    let isCurrent!: () => boolean
    const module = moduleFixture('commands', {
      contributions: [
        contribution('run', {
          pointId: 'host.commands',
          inputSchema: 'command.v1',
          eventSchema: 'result.v1',
          implementation: 'host-command',
        }),
      ],
    })
    module.activate = (scope) => {
      isCurrent = scope.isCurrent
      return {
        contributionIds: ['run'],
        commands: [
          {
            localId: 'run',
            validate: () => true,
            execute: () => {
              entered.resolve()
              return result.promise
            },
          },
        ],
      }
    }
    const controller = new ModuleController({
      builtIns: [module],
      points,
      readCommandContext: () => context,
    })
    const command = controller.executeCommand('commands/run', {
      objectRevision: 1,
      viewRevision: 1,
    })
    const rejected = expect(command).rejects.toThrow('stale-command')
    await entered.promise
    expect(isCurrent()).toBe(true)
    await controller.setEnabled('commands', false)
    expect(isCurrent()).toBe(false)
    result.resolve('late')
    await rejected
  })
  it('separates installation, enabled intent, activation, availability and login', async () => {
    const controller = new ModuleController({
      builtIns: [moduleFixture('one')],
      points,
      readCommandContext: () => context,
    })
    expect(controller.states.get('one')).toMatchObject({
      installed: true,
      enabled: true,
      activation: 'inactive',
      availability: 'unchecked',
      login: 'unknown',
    })
    await controller.activate(['one'])
    await controller.updateAvailability('one', 'available', 'signed-out')
    expect(controller.states.get('one')).toMatchObject({
      activation: 'active',
      login: 'signed-out',
    })
    await controller.setEnabled('one', false)
    expect(controller.states.get('one')).toMatchObject({
      enabled: false,
      activation: 'inactive',
      login: 'signed-out',
    })
  })
  it('coalesces concurrent activation and retries failed loads', async () => {
    const module = moduleFixture('one')
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('import failed'))
      .mockResolvedValue({ contributionIds: ['view'] })
    module.activate = loader
    const controller = new ModuleController({
      builtIns: [module],
      points,
      readCommandContext: () => context,
    })
    await expect(controller.activate(['one'])).rejects.toThrow('import failed')
    await Promise.all([
      controller.activate(['one']),
      controller.activate(['one']),
      controller.activate(['one']),
    ])
    expect(loader).toHaveBeenCalledTimes(2)
    expect(controller.states.get('one')?.activation).toBe('active')
  })
  it('shares a concurrent failed activation without retrying until a new request', async () => {
    const module = moduleFixture('one')
    const load = vi.fn().mockRejectedValue(new Error('import failed'))
    module.activate = load
    const controller = new ModuleController({
      builtIns: [module],
      points,
      readCommandContext: () => context,
    })
    await Promise.allSettled([controller.activate(['one']), controller.activate(['one'])])
    expect(load).toHaveBeenCalledTimes(1)
    await expect(controller.activate(['one'])).rejects.toThrow('import failed')
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('unblocks the publication queue on replacement without waiting for an uncooperative old loader', async () => {
    const pending = deferred<ModuleInstance>()
    const started = deferred<void>()
    const module = moduleFixture('one')
    module.activate = () => {
      started.resolve()
      return pending.promise
    }
    const controller = new ModuleController({
      builtIns: [module],
      points,
      readCommandContext: () => context,
    })
    const stale = expect(controller.activate(['one'])).rejects.toThrow('stale-activation')
    await started.promise
    await controller.replaceBuiltIn(moduleFixture('one', { installationId: 'new-install' }))
    await controller.activate(['one'])
    expect(controller.allocation.slots['workspace.views']).toEqual(['one/view'])
    pending.resolve({ contributionIds: ['view'] })
    await stale
  })
  it('publishes multi-module batches once and releases partial preparation in reverse order', async () => {
    const released: string[] = []
    const provider = moduleFixture('provider', { provides: [{ id: 'service', version: 1 }] })
    provider.activate = (scope) => {
      scope.defer(() => {
        released.push('provider')
      })
      return { contributionIds: ['view'] }
    }
    const consumer = moduleFixture('consumer', { requires: [{ id: 'service', version: 1 }] })
    consumer.activate = (scope) => {
      scope.defer(() => {
        released.push('consumer-first')
      })
      scope.defer(() => {
        released.push('consumer-last')
      })
      throw new Error('consumer failed')
    }
    const controller = new ModuleController({
      builtIns: [consumer, provider],
      points,
      readCommandContext: () => context,
    })
    const before = controller.allocation
    const publish = vi.fn()
    controller.subscribe(publish)
    await expect(controller.activate(['consumer'])).rejects.toThrow('consumer failed')
    expect(controller.allocation).toBe(before)
    expect(publish).not.toHaveBeenCalled()
    expect(released).toEqual(['consumer-last', 'consumer-first', 'provider'])
    consumer.activate = () => ({ contributionIds: ['view'] })
    // Build records copy the loader; replacement is an explicit host operation.
    await controller.replaceBuiltIn(consumer)
    publish.mockClear()
    await controller.activate(['consumer'])
    expect(publish).toHaveBeenCalledTimes(1)
    expect(controller.allocation.slots['workspace.views']).toEqual([
      'consumer/view',
      'provider/view',
    ])
  })
  it('keeps a previous valid allocation when a new batch violates its declared contract', async () => {
    const broken = moduleFixture('broken')
    const dispose = vi.fn()
    broken.activate = (scope) => {
      scope.defer(dispose)
      return { contributionIds: ['undeclared'] }
    }
    const controller = new ModuleController({
      builtIns: [moduleFixture('valid'), broken],
      points,
      readCommandContext: () => context,
    })
    await controller.activate(['valid'])
    const before = controller.allocation
    await expect(controller.activate(['broken'])).rejects.toThrow('activation-contract')
    expect(controller.allocation).toBe(before)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
  it.each(['disable', 'replace', 'dispose'] as const)(
    'rejects late activation after %s and releases resources exactly once',
    async (action) => {
      const pending = deferred<ModuleInstance>()
      const started = deferred<void>()
      const dispose = vi.fn()
      const module = moduleFixture('one')
      module.activate = (scope) => {
        scope.defer(dispose)
        started.resolve()
        return pending.promise
      }
      const controller = new ModuleController({
        builtIns: [module],
        points,
        readCommandContext: () => context,
      })
      const activation = controller.activate(['one'])
      const rejected = expect(activation).rejects.toThrow('stale-activation')
      await started.promise
      if (action === 'disable') await controller.setEnabled('one', false)
      else if (action === 'replace')
        await controller.replaceBuiltIn(
          moduleFixture('one', { installationId: 'reinstalled', contentHash: 'new-hash' }),
        )
      else await controller.dispose()
      expect(dispose).toHaveBeenCalledTimes(1)
      pending.resolve({ contributionIds: ['view'] })
      await rejected
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(controller.allocation.slots['workspace.views']).toEqual([])
      if (action === 'replace') {
        await controller.activate(['one'])
        expect(controller.allocation.slots['workspace.views']).toEqual(['one/view'])
      }
    },
  )
  it('protects required providers and cleans consumers before dependencies even if cleanup fails', async () => {
    const released: string[] = []
    const provider = moduleFixture('provider', { provides: [{ id: 'service', version: 1 }] })
    const consumer = moduleFixture('consumer', { requires: [{ id: 'service', version: 1 }] })
    provider.activate = (scope) => {
      scope.defer(() => {
        released.push('provider')
      })
      return { contributionIds: ['view'] }
    }
    consumer.activate = (scope) => {
      scope.defer(() => {
        released.push('consumer')
        throw new Error('cleanup')
      })
      return { contributionIds: ['view'] }
    }
    const cleanupFailure = vi.fn()
    const controller = new ModuleController({
      builtIns: [provider, consumer, moduleFixture('core', { required: true })],
      points,
      readCommandContext: () => context,
      onCleanupFailure: cleanupFailure,
    })
    expect(() => controller.setEnabled('core', false)).toThrow('required-module')
    await expect(controller.replaceBuiltIn(moduleFixture('core'))).rejects.toThrow(
      'required-module',
    )
    await controller.activate(['consumer'])
    await controller.setEnabled('provider', false)
    expect(released).toEqual(['consumer', 'provider'])
    expect(cleanupFailure).toHaveBeenCalledWith('consumer')
    expect(controller.states.get('consumer')?.enabled).toBe(true)
    await expect(controller.activate(['consumer'])).rejects.toThrow('dependency-missing')
  })
  it('reports required startup failures to an independent recovery path', async () => {
    const broken = moduleFixture('core', { required: true })
    broken.activate = () => {
      throw new Error('core failure')
    }
    const report = vi.fn()
    const disableOptionalModules = vi.fn()
    const restoreDefaultTheme = vi.fn()
    const recovery = createModuleRecovery({
      readFailure: () => ({ moduleIds: ['core'], reason: 'previous' }),
      writeFailure: report,
      disableOptionalModules,
      restoreDefaultTheme,
    })
    const controller = new ModuleController({
      builtIns: [broken],
      points,
      readCommandContext: () => context,
      onRequiredFailure: recovery.report,
    })
    await expect(controller.start()).rejects.toThrow('core failure')
    expect(report).toHaveBeenCalledWith({ moduleIds: ['core'], reason: 'activation-failed' })
    expect(recovery.readFailure()?.reason).toBe('previous')
    await recovery.safeStart()
    expect(disableOptionalModules).toHaveBeenCalledTimes(1)
    expect(restoreDefaultTheme).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenLastCalledWith(undefined)
  })
  it('rechecks context, gesture, native permission epoch and module generation at command execution', async () => {
    let current = { ...context }
    let epoch = 1
    let allowed = true
    const execute = vi.fn()
    const command = moduleFixture('commands', {
      contributions: [
        contribution('run', {
          pointId: 'host.commands',
          inputSchema: 'command.v1',
          eventSchema: 'result.v1',
          implementation: 'host-command',
          when: { field: 'area', equals: 'catalog' },
        }),
      ],
    })
    command.activate = () => ({
      contributionIds: ['run'],
      commands: [{ localId: 'run', validate: () => true, execute }],
    })
    const controller = new ModuleController({
      builtIns: [command],
      points,
      readCommandContext: () => current,
      readPolicy: () => ({ permissionEpoch: epoch, isAuthorized: () => allowed }),
    })
    const expected = { objectRevision: 1, viewRevision: 1 }
    await controller.executeCommand('commands/run', expected)
    expect(execute).toHaveBeenCalledTimes(1)
    for (const patch of [
      { userGesture: false },
      { objectRevision: 2 },
      { viewRevision: 2 },
      { area: 'queue' },
    ]) {
      current = { ...context, ...patch }
      // eslint-disable-next-line no-await-in-loop -- Each case mutates the authoritative host context.
      await expect(controller.executeCommand('commands/run', expected)).rejects.toThrow(
        'command-context-denied',
      )
    }
    current = context
    const pending = controller.executeCommand('commands/run', expected)
    epoch++
    await expect(pending).rejects.toThrow()
    allowed = false
    const invalidating = controller.refreshPolicy()
    expect(controller.allocation.slots['host.commands']).toEqual([])
    await invalidating
    await expect(controller.executeCommand('commands/run', expected)).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
