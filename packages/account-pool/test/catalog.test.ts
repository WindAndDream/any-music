import { DEFAULT_ATTEMPT_POLICY } from '@any-music/network-routing'
import { describe, expect, it } from 'vitest'

import { AccountCatalog, operationKey, validateAccountOperationPolicy } from '../src/index'
import type { AccountProfile } from '../src/index'

function account(id = 'a', platformId = 'bilibili'): AccountProfile {
  return {
    id,
    platformId,
    name: `账号 ${id}`,
    authentication: 'credential',
    credentialKey: `vault_${id}`,
    enabled: true,
    status: 'ready',
  }
}

describe('public account catalog', () => {
  it('supports multiple named accounts and manually named anonymous identities', () => {
    const catalog = new AccountCatalog()
    catalog.save(account('a'))
    catalog.save(account('b'))
    catalog.save({
      ...account('c', 'api-source'),
      authentication: 'anonymous',
      credentialKey: undefined,
      username: '我输入的账号',
    })
    expect(catalog.list('bilibili').map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(catalog.get('c')).toMatchObject({
      authentication: 'anonymous',
      username: '我输入的账号',
    })
  })
  it('rejects duplicate names and platform identities within a platform', () => {
    const catalog = new AccountCatalog()
    catalog.save({ ...account(), platformUserId: '123' })
    expect(() => catalog.save({ ...account('b'), name: '账号 a' })).toThrow('Duplicate')
    expect(() => catalog.save({ ...account('b'), platformUserId: '123' })).toThrow(
      'already registered',
    )
    expect(() =>
      catalog.save({ ...account('b', 'douyin'), name: '账号 a', platformUserId: '123' }),
    ).not.toThrow()
  })
  it('invalidates active leases on disable, expiry, credential rotation and deletion', () => {
    for (const update of [
      (catalog: AccountCatalog) => catalog.save({ ...account(), enabled: false }),
      (catalog: AccountCatalog) => catalog.save({ ...account(), status: 'expired' }),
      (catalog: AccountCatalog) => catalog.save({ ...account(), credentialKey: 'new_vault' }),
      (catalog: AccountCatalog) => catalog.remove('a'),
    ]) {
      const catalog = new AccountCatalog()
      catalog.save(account())
      const lease = catalog.acquire('a')!
      update(catalog)
      expect(lease.cancellation.isCancelled()).toBe(true)
      lease.release()
      lease.release()
    }
  })
  it('renaming preserves leases and immutable snapshots protect state', () => {
    const catalog = new AccountCatalog()
    catalog.save(account())
    const lease = catalog.acquire('a')!
    catalog.save({ ...account(), name: '新名字' })
    expect(lease.cancellation.isCancelled()).toBe(false)
    expect(Object.isFrozen(catalog.get('a'))).toBe(true)
    expect(() => {
      ;(catalog.get('a') as AccountProfile).enabled = false
    }).toThrow()
  })
  it('keeps an explicitly empty range empty after its last account is removed', () => {
    const catalog = new AccountCatalog()
    catalog.save(account('a'))
    catalog.save(account('b'))
    catalog.savePolicy('bilibili', 'search', {
      ...DEFAULT_ATTEMPT_POLICY,
      selection: 'shuffle',
      accountIds: ['a'],
    })
    catalog.remove('a')
    const policy = catalog.getPolicy('bilibili', 'search')!
    expect(policy.accountIds).toEqual([])
    expect(catalog.eligible('bilibili', policy)).toEqual([])
    expect(
      catalog.eligible('bilibili', { ...policy, accountIds: undefined }).map((entry) => entry.id),
    ).toEqual(['b'])
  })
  it('excludes disabled, expired, challenged, blocked and foreign platform identities', () => {
    const catalog = new AccountCatalog()
    catalog.save(account('ready'))
    catalog.save({ ...account('disabled'), enabled: false })
    catalog.save({ ...account('expired'), status: 'expired' })
    catalog.save({ ...account('challenge'), status: 'verification-required' })
    catalog.save({ ...account('blocked'), status: 'network-blocked' })
    catalog.save(account('other', 'douyin'))
    const policy = { ...DEFAULT_ATTEMPT_POLICY, selection: 'random' as const }
    expect(catalog.eligible('bilibili', policy).map((entry) => entry.id)).toEqual(['ready'])
    expect(() =>
      catalog.savePolicy('bilibili', 'search', { ...policy, accountIds: ['other'] }),
    ).toThrow('foreign')
  })
  it('whitelists metadata so extra secret fields cannot enter snapshots', () => {
    const catalog = new AccountCatalog()
    catalog.save({
      ...account(),
      cookies: 'secret-cookie',
      token: 'secret-token',
    } as AccountProfile)
    expect(JSON.stringify(catalog.list())).not.toContain('secret')
    const policy = validateAccountOperationPolicy({
      ...DEFAULT_ATTEMPT_POLICY,
      selection: 'random',
      password: 'secret',
    } as Parameters<typeof validateAccountOperationPolicy>[0])
    expect(JSON.stringify(policy)).not.toContain('secret')
    expect(operationKey('a:b', 'c')).not.toBe(operationKey('a', 'b:c'))
  })
  it('enforces identity immutability and bounded inputs', () => {
    const catalog = new AccountCatalog()
    catalog.save(account())
    expect(() => catalog.save(account('a', 'douyin'))).toThrow('immutable')
    expect(() => catalog.save({ ...account('b'), name: '  ' })).toThrow()
    expect(() => catalog.save({ ...account('b'), name: 'x'.repeat(65) })).toThrow()
    expect(() => catalog.save({ ...account('b'), credentialKey: 'cookie=a' })).toThrow()
    for (let index = 1; index < 256; index++) catalog.save(account(`id${index}`))
    expect(() => catalog.save(account('overflow'))).toThrow(RangeError)
  })
})
