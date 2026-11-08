import { createConfirmationDialogController } from '@any-music/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useAccountNameDraft } from '@/features/accounts/account-editor-state'
import { AccountRuntime } from '@/features/accounts/account-runtime'
import type { NativeAccount } from '@/features/accounts/account-runtime'
import { useAccountSettings } from '@/features/accounts/use-account-settings'

const native = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
beforeEach(() => native.invoke.mockReset().mockResolvedValue(undefined))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const account = (id: string): NativeAccount => ({
  backupProxyIds: [],
  state: {
    login: (['expired', 'signed-out'].includes('expired') ? 'signed-out' : 'signed-in') as
      | 'signed-in'
      | 'signed-out',
    verification: 'not-required' as const,
    connection: 'available' as const,
  },

  id,
  name: id,
  platformId: 'bilibili',
  status: 'expired',
  enabled: true,
  authentication: 'credential',
  proxyId: null,
  userAgent: '',
  webId: '',
})

describe('desktop account settings entry', () => {
  it('resets account editor cells on real navigation and close without changing saved accounts', () => {
    const { settings, scope } = setup()
    settings.selectAccountDetail(account('first'))
    settings.showSection('name')
    useAccountNameDraft('first', settings.editing).value = 'Unsubmitted name'
    settings.back()
    settings.showSection('name')
    expect(useAccountNameDraft('first', settings.editing).value).toBe('first')
    useAccountNameDraft('first', settings.editing).value = 'Another draft'
    settings.close()
    expect(useAccountNameDraft('first', settings.editing).value).toBe('first')
    expect(settings.snapshot.value.accounts.map((item) => item.name)).toContain('first')
    scope.stop()
  })
  it('rejects platforms absent from the mobile source directory before native work', async () => {
    vi.stubGlobal('window', new EventTarget())
    const runtime = new AccountRuntime()
    vi.spyOn(runtime, 'refresh').mockResolvedValue()
    const scope = effectScope()
    const settings = scope.run(() =>
      useAccountSettings(runtime, [{ id: 'bilibili', name: '哔哩哔哩' }]),
    )!
    await settings.add('douyin', '抖音账号')
    expect(native.invoke).not.toHaveBeenCalledWith('create_account', expect.anything())
    expect(settings.error.value).toContain('未提供')
    settings.selectPlatform('douyin')
    expect(settings.section.value).toBeNull()
    settings.selectLogin({ ...account('douyin'), platformId: 'douyin' })
    expect(settings.section.value).toBeNull()
    window.dispatchEvent(new CustomEvent('any-music:open-account-login', { detail: 'douyin' }))
    expect(settings.open.value).toBe(false)
    expect(settings.platforms.map((platform) => platform.id)).toEqual(['bilibili'])
    scope.stop()
  })
  function setup() {
    vi.stubGlobal('window', new EventTarget())
    const runtime = new AccountRuntime()
    vi.spyOn(runtime, 'refresh').mockResolvedValue()
    runtime.snapshot.value = {
      accounts: [
        account('first'),
        account('second'),
        { ...account('douyin'), platformId: 'douyin' },
      ],
      proxies: [],
    }
    const scope = effectScope()
    const settings = scope.run(() => useAccountSettings(runtime))!
    return { runtime, scope, settings }
  }
  it('validates platform-scoped trimmed names on both creation and rename', async () => {
    const { settings, scope } = setup()
    await settings.add('bilibili', ' first ')
    expect(settings.error.value).toContain('同名账号')
    expect(native.invoke).not.toHaveBeenCalledWith('create_account', expect.anything())
    await settings.update({ ...account('second'), name: 'first' })
    expect(native.invoke).not.toHaveBeenCalledWith('update_account', expect.anything())
    await settings.update({
      ...account('second'),
      name: 'douyin',
      proxyId: 'primary',
      backupProxyIds: ['one', 'two'],
    })
    expect(native.invoke).toHaveBeenCalledWith(
      'update_account',
      expect.objectContaining({ name: 'douyin', backupProxyIds: ['one', 'two'] }),
    )
    scope.stop()
  })
  it('allows confirmation for an in-use account and keeps cleanup failures visible', async () => {
    const { settings, scope } = setup()
    const confirmation = createConfirmationDialogController()
    settings.selectAccountDetail(account('first'))
    native.invoke.mockImplementation(async (command: string) =>
      command === 'account_usage' ? ['播放或下载'] : undefined,
    )
    const cancelled = settings.requestRemove(account('first'), confirmation.confirm)
    expect(settings.error.value).toBe('')
    expect(confirmation.activeRequest.value).toMatchObject({
      title: '删除账号',
      tone: 'danger',
      message: expect.stringMatching(/“first”.*登录状态.*下载.*账号名称历史/s),
      details: undefined,
    })
    expect(native.invoke).not.toHaveBeenCalledWith('account_usage', expect.anything())
    expect(native.invoke).not.toHaveBeenCalledWith('remove_account', expect.anything())
    confirmation.cancel()
    await cancelled
    expect(native.invoke).not.toHaveBeenCalledWith('remove_account', expect.anything())
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'account_usage') return []
      if (command === 'remove_account') throw '账号已停用，但浏览器目录仍被占用。'
    })
    const pending = settings.requestRemove(account('first'), confirmation.confirm)
    confirmation.accept()
    await pending
    expect(native.invoke).toHaveBeenCalledWith('remove_account', { accountId: 'first' })
    expect(settings.section.value).toBe('details')
    expect(settings.error.value).toBe('')
    expect(settings.removeNotice.message.value).toContain('浏览器目录')
    scope.stop()
  })
  it('removes only after confirmation and returns to the platform account list', async () => {
    const { settings, scope } = setup()
    const confirmation = createConfirmationDialogController()
    settings.selectAccountDetail(account('first'))
    const pending = settings.requestRemove(account('first'), confirmation.confirm)
    // A second click must not queue another deletion behind the same confirmation.
    await settings.requestRemove(account('first'), confirmation.confirm)
    expect(native.invoke).not.toHaveBeenCalledWith('remove_account', expect.anything())
    confirmation.accept()
    await pending
    expect(native.invoke.mock.calls.filter(([command]) => command === 'remove_account')).toEqual([
      ['remove_account', { accountId: 'first' }],
    ])
    expect(settings.section.value).toBe('accounts')
    expect(settings.selectedAccount.value).toBeUndefined()
    scope.stop()
  })
  it.each(['navigate', 'reopen', 'dispose', 'busy', 'checking'])(
    'ignores a confirmation after the account view changes: %s',
    async (change) => {
      const { settings, scope } = setup()
      const confirmation = createConfirmationDialogController()
      settings.selectAccountDetail(account('first'))
      const pending = settings.requestRemove(account('first'), confirmation.confirm)
      if (change === 'navigate') settings.selectAccountDetail(account('second'))
      if (change === 'reopen') {
        settings.closeDetail()
        settings.selectAccountDetail(account('first'))
      }
      if (change === 'dispose') scope.stop()
      if (change === 'busy') settings.busy.value = true
      if (change === 'checking') settings.checking.value = true
      confirmation.accept()
      await pending
      expect(native.invoke).not.toHaveBeenCalledWith('remove_account', expect.anything())
      scope.stop()
    },
  )
  it('returns from child editors and cancels login before returning to account management', () => {
    const { settings, scope } = setup()
    settings.selectAccountDetail(account('first'))
    settings.showSection('connection')
    settings.back()
    expect(settings.section.value).toBe('details')
    settings.selectLogin(account('first'))
    settings.back()
    expect(settings.loginAccount.value).toBeUndefined()
    expect(settings.section.value).toBe('details')
    settings.back()
    expect(settings.section.value).toBe('accounts')
    expect(settings.selectedAccount.value).toBeUndefined()
    settings.back()
    expect(settings.section.value).toBeNull()
    scope.stop()
  })
  it('preserves the creation draft inside its popup while choosing a platform', () => {
    const { settings, scope } = setup()
    settings.startAdd()
    settings.createName.value = '常用账号'
    expect(settings.detailOpen.value).toBe(true)
    expect(settings.breadcrumbs.value.map((item) => item.label)).toEqual(['添加账号'])
    settings.showSection('platform')
    expect(settings.breadcrumbs.value.map((item) => item.label)).toEqual(['添加账号', '选择平台'])
    settings.choosePlatform('douyin')
    expect(settings.section.value).toBe('add')
    expect(settings.addPlatform.value).toBe('douyin')
    expect(settings.createName.value).toBe('常用账号')
    expect(settings.detailOpen.value).toBe(true)
    settings.back()
    expect(settings.detailOpen.value).toBe(false)
    scope.stop()
  })
  it('adds from a platform and keeps the popup rooted at that platform', () => {
    const { settings, scope } = setup()
    settings.selectPlatform('douyin')
    settings.startAdd('douyin')
    expect(settings.addPlatform.value).toBe('douyin')
    settings.createName.value = '未提交的名称'
    settings.showSection('platform')
    expect(settings.breadcrumbs.value.map((item) => item.label)).toEqual([
      '抖音',
      '添加账号',
      '选择平台',
    ])
    settings.choosePlatform('bilibili')
    expect(settings.breadcrumbs.value.map((item) => item.label)).toEqual(['哔哩哔哩', '添加账号'])
    settings.back()
    expect(settings.section.value).toBe('accounts')
    expect(settings.selectedPlatform.value).toBe('bilibili')
    expect(settings.createName.value).toBe('未提交的名称')
    scope.stop()
  })
  it('opens standalone creation for Discover and closes directly after choosing another platform', () => {
    const { settings, scope } = setup()
    settings.startAdd('netease', { standalone: true })
    expect(settings.open.value).toBe(false)
    expect(settings.detailOpen.value).toBe(true)
    expect(settings.addPlatform.value).toBe('netease')
    expect(settings.isDialogRoot.value).toBe(true)
    expect(settings.breadcrumbs.value.map((item) => item.label)).toEqual(['添加账号'])
    settings.showSection('platform')
    settings.choosePlatform('douyin')
    settings.back()
    expect(settings.detailOpen.value).toBe(false)
    expect(settings.open.value).toBe(false)
    scope.stop()
  })
  it('closes child popups to the platform overview and retains only the creation draft', () => {
    const { settings, scope } = setup()
    settings.startAdd()
    settings.createName.value = '草稿'
    settings.showSection('platform')
    settings.closeDetail()
    expect(settings.section.value).toBeNull()
    expect(settings.detailOpen.value).toBe(false)
    expect(settings.createName.value).toBe('草稿')
    settings.selectPlatform('bilibili')
    settings.selectAccountDetail(account('first'))
    settings.showSection('connection')
    settings.navigate('accounts')
    settings.navigate('root')
    expect(settings.section.value).toBe('accounts')
    expect(settings.detailOpen.value).toBe(true)
    settings.close()
    expect(settings.section.value).toBeNull()
    scope.stop()
  })
  it('opens login after creation within the newly created account platform', async () => {
    const { settings, scope } = setup()
    const created = account('created')
    native.invoke.mockImplementation(async (command: string) =>
      command === 'create_account' ? created : undefined,
    )
    settings.startAdd()
    await settings.add('bilibili', 'created')
    expect(settings.section.value).toBe('login')
    expect(settings.selectedAccount.value?.id).toBe('created')
    expect(settings.breadcrumbs.value.map((item) => item.label)).toEqual([
      '哔哩哔哩',
      'created',
      '登录与验证',
    ])
    scope.stop()
  })
  it.each(['back', 'breadcrumb'] as const)(
    'returns an unfinished account draft to its filled creation form via %s',
    async (route) => {
      const { settings, scope } = setup()
      native.invoke.mockImplementation(async (command: string) =>
        command === 'create_account' ? { ...account('created'), pending: true } : undefined,
      )
      settings.startAdd()
      await settings.add('bilibili', 'created')
      if (route === 'back') settings.back()
      else settings.navigate('details')
      expect(settings.section.value).toBe('add')
      expect(settings.createName.value).toBe('created')
      expect(settings.addPlatform.value).toBe('bilibili')
      expect(settings.selectedAccount.value).toBeUndefined()
      await settings.waitForCleanup()
      expect(native.invoke).toHaveBeenCalledWith('discard_account_draft', { accountId: 'created' })
      scope.stop()
    },
  )
  it('returns to saved account details after login and after a draft is committed', () => {
    const { runtime, settings, scope } = setup()
    settings.selectLogin(account('first'))
    settings.back()
    expect(settings.section.value).toBe('details')
    expect(settings.selectedAccount.value?.id).toBe('first')

    settings.selectLogin({ ...account('created'), pending: true })
    runtime.snapshot.value = {
      ...runtime.snapshot.value,
      accounts: [...runtime.snapshot.value.accounts, account('created')],
    }
    settings.navigate('details')
    expect(settings.section.value).toBe('details')
    expect(settings.selectedAccount.value?.id).toBe('created')
    scope.stop()
  })
  it('returns to the account list if the login account is no longer available', () => {
    const { settings, scope } = setup()
    settings.selectLogin(account('removed'))
    settings.back()
    expect(settings.section.value).toBe('accounts')
    expect(settings.selectedAccount.value).toBeUndefined()
    scope.stop()
  })
  it('jumps from nested editors to account, platform and overview paths', () => {
    const { settings, scope } = setup()
    expect(settings.detailOpen.value).toBe(false)
    settings.selectPlatform('douyin')
    expect(settings.detailOpen.value).toBe(true)
    settings.selectAccountDetail({ ...account('douyin'), platformId: 'douyin' })
    settings.showSection('name')
    expect(settings.breadcrumbs.value.map((item) => item.label)).toEqual([
      '抖音',
      'douyin',
      '账号名称',
    ])
    settings.navigate('details')
    expect(settings.section.value).toBe('details')
    settings.selectLogin({ ...account('douyin'), platformId: 'douyin' })
    settings.navigate('accounts')
    expect(settings.loginAccount.value).toBeUndefined()
    expect(settings.breadcrumbs.value.map((item) => item.label)).toEqual(['抖音'])
    settings.navigate('root')
    expect(settings.section.value).toBe('accounts')
    expect(settings.selectedAccount.value).toBeUndefined()
    expect(settings.detailOpen.value).toBe(true)
    settings.back()
    expect(settings.section.value).toBeNull()
    scope.stop()
  })
  it('does not reopen an editor when a save completes after the panel closes', async () => {
    const { settings, scope } = setup()
    let complete!: () => void
    native.invoke.mockImplementation((command: string) =>
      command === 'update_account'
        ? new Promise<void>((resolve) => {
            complete = resolve
          })
        : Promise.resolve(),
    )
    settings.selectAccountDetail(account('first'))
    settings.showSection('name')
    const pending = settings.saveAccount({ ...account('first'), name: 'renamed' })
    settings.closeDetail()
    expect(settings.busy.value).toBe(true)
    complete()
    await pending
    expect(settings.section.value).toBeNull()
    expect(settings.busy.value).toBe(false)
    scope.stop()
  })
  it('does not replace a reopened creation popup with a late login or clear its draft', async () => {
    const { settings, scope } = setup()
    let complete!: (account: NativeAccount) => void
    native.invoke.mockImplementation((command: string) =>
      command === 'create_account'
        ? new Promise<NativeAccount>((resolve) => {
            complete = resolve
          })
        : Promise.resolve(),
    )
    settings.startAdd()
    const pending = settings.add('bilibili', 'created')
    await vi.waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith('create_account', expect.anything()),
    )
    settings.closeDetail()
    settings.startAdd('douyin')
    settings.createName.value = '下一账号草稿'
    complete({ ...account('created'), pending: true })
    await pending
    expect(settings.section.value).toBe('add')
    expect(settings.addPlatform.value).toBe('douyin')
    expect(settings.createName.value).toBe('下一账号草稿')
    expect(settings.loginAccount.value).toBeUndefined()
    expect(native.invoke).toHaveBeenCalledWith('discard_account_draft', { accountId: 'created' })
    expect(settings.busy.value).toBe(false)
    scope.stop()
  })
  it('preselects the requested platform when login needs a new account', () => {
    const { settings, runtime, scope } = setup()
    runtime.snapshot.value = { accounts: [], proxies: [] }
    window.dispatchEvent(new CustomEvent('any-music:open-account-login', { detail: 'douyin' }))
    expect(settings.open.value).toBe(true)
    expect(settings.detailOpen.value).toBe(true)
    expect(settings.section.value).toBe('add')
    expect(settings.addPlatform.value).toBe('douyin')
    expect(settings.breadcrumbs.value.map((item) => item.label)).toEqual(['抖音', '添加账号'])
    scope.stop()
  })
  it('opens login for the manually selected account and releases the entry listener on disposal', () => {
    const events = new EventTarget()
    vi.stubGlobal('window', events)
    const runtime = new AccountRuntime()
    vi.spyOn(runtime, 'refresh').mockResolvedValue()
    runtime.snapshot.value = { accounts: [account('first'), account('selected')], proxies: [] }
    runtime.selectedAccountIds.value = { bilibili: 'selected' }
    const scope = effectScope()
    const settings = scope.run(() => useAccountSettings(runtime))!
    events.dispatchEvent(new CustomEvent('any-music:open-account-login', { detail: 'bilibili' }))
    expect(settings.open.value).toBe(true)
    expect(settings.loginAccount.value?.id).toBe('selected')
    settings.close()
    scope.stop()
    events.dispatchEvent(new CustomEvent('any-music:open-account-login', { detail: 'bilibili' }))
    expect(settings.open.value).toBe(false)
  })
})
