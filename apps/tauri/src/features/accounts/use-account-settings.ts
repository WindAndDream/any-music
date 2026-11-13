import { createEditingSession, useToastNotice } from '@any-music/ui'
import type { ConfirmAction } from '@any-music/ui'
import { invoke } from '@tauri-apps/api/core'
import { computed, onScopeDispose, shallowRef, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { ACCOUNT_PLATFORMS, accountNameError, platformName } from './account-presentation'
import type { AccountRuntime, NativeAccount } from './account-runtime'
import type { AccountPlatform } from './source-authentication'
import { useAccountChecks } from './use-account-checks'
import { useAccountLogin } from './use-account-login'

type AccountSection = 'add' | 'platform' | 'accounts' | 'details' | 'name' | 'connection' | 'login'
export interface AccountPathItem {
  id: AccountSection | 'root'
  label: string
}
const SECTION_TITLES = {
  add: '添加账号',
  platform: '选择平台',
  accounts: '平台账号',
  details: '账号详情',
  name: '账号名称',
  connection: '请求连接',
  login: '登录与验证',
}

export function useAccountSettings(
  runtime: AccountRuntime,
  platformOptions: MaybeRefOrGetter<readonly AccountPlatform[]> = ACCOUNT_PLATFORMS,
) {
  const platforms = computed(() => toValue(platformOptions))
  const open = shallowRef(false)
  const busy = shallowRef(false)
  const error = shallowRef('')
  const removeNotice = useToastNotice({ durationMs: 5000 })
  const section = shallowRef<AccountSection | null>(null)
  // Each popup owns its path; the settings overview is outside that navigation tree.
  const dialogRoot = shallowRef<'add' | 'accounts'>('accounts')
  const addPlatform = shallowRef<NativeAccount['platformId']>(platforms.value[0]?.id ?? '')
  const createName = shallowRef('')
  const editing = createEditingSession()
  const selectedPlatform = shallowRef<NativeAccount['platformId']>(platforms.value[0]?.id ?? '')
  const selectedId = shallowRef<string>()
  let navigationRevision = 0
  const login = useAccountLogin(runtime, { busy, error })
  const checks = useAccountChecks(runtime, (account) =>
    platforms.value.some((platform) => platform.id === account.platformId),
  )
  const supportsPlatform = (id: string) => platforms.value.some((platform) => platform.id === id)
  const nameOf = (id: string) =>
    platforms.value.find((platform) => platform.id === id)?.name ?? platformName(id)
  const { endLogin } = login
  const selectedAccount = computed(
    () =>
      runtime.snapshot.value.accounts.find((account) => account.id === selectedId.value) ??
      login.loginAccount.value,
  )
  function showSection(value: NonNullable<typeof section.value>) {
    navigationRevision++
    editing.reset()
    if (section.value === 'login' && value === 'details') {
      const account = selectedAccount.value
      if (account?.pending) {
        // Leaving login discards the native draft, so return to a usable creation form.
        addPlatform.value = account.platformId
        createName.value = account.name
        value = 'add'
      } else if (!runtime.snapshot.value.accounts.some((item) => item.id === selectedId.value)) {
        value = 'accounts'
      }
    }
    if (section.value === 'login' && value !== 'login') endLogin()
    error.value = ''
    if (value === 'add' || value === 'accounts') selectedId.value = undefined
    section.value = value
  }
  function startAdd(
    platform?: NativeAccount['platformId'],
    options: { standalone?: boolean } = {},
  ) {
    if (platform && !supportsPlatform(platform)) return
    dialogRoot.value = platform && !options.standalone ? 'accounts' : 'add'
    if (platform) {
      selectedPlatform.value = platform
      addPlatform.value = platform
    }
    showSection('add')
  }
  function selectAccountDetail(account: NativeAccount) {
    if (!supportsPlatform(account.platformId)) return
    if (section.value === 'login') endLogin()
    selectedId.value = account.id
    selectedPlatform.value = account.platformId
    dialogRoot.value = 'accounts'
    showSection('details')
  }
  function selectLogin(account: NativeAccount) {
    if (!supportsPlatform(account.platformId)) return
    selectedId.value = account.id
    selectedPlatform.value = account.platformId
    dialogRoot.value = 'accounts'
    login.selectLogin(account)
    showSection('login')
  }
  function closeDetail() {
    navigationRevision++
    editing.reset()
    endLogin()
    section.value = null
    selectedId.value = undefined
  }
  function back() {
    const current = section.value
    if (!current || current === dialogRoot.value) return closeDetail()
    if (current === 'add') return showSection('accounts')
    if (current === 'platform') return showSection('add')
    showSection(current === 'details' ? 'accounts' : 'details')
  }
  function selectPlatform(platform: NativeAccount['platformId']) {
    if (!supportsPlatform(platform)) return
    selectedPlatform.value = platform
    dialogRoot.value = 'accounts'
    showSection('accounts')
  }
  function choosePlatform(platform: NativeAccount['platformId']) {
    if (!supportsPlatform(platform)) return
    addPlatform.value = platform
    if (dialogRoot.value === 'accounts') selectedPlatform.value = platform
    showSection('add')
  }
  const detailOpen = computed(() => section.value !== null)
  const breadcrumbs = computed<AccountPathItem[]>(() => {
    if (!section.value) return []
    const path: AccountPathItem[] = [
      {
        id: 'root',
        label: dialogRoot.value === 'add' ? SECTION_TITLES.add : nameOf(selectedPlatform.value),
      },
    ]
    if (section.value === 'add' || section.value === 'platform') {
      if (dialogRoot.value !== 'add') path.push({ id: 'add', label: SECTION_TITLES.add })
      if (section.value === 'platform')
        path.push({ id: 'platform', label: SECTION_TITLES.platform })
      return path
    }
    if (selectedAccount.value) path.push({ id: 'details', label: selectedAccount.value.name })
    if (!['accounts', 'details'].includes(section.value))
      path.push({ id: section.value, label: SECTION_TITLES[section.value] })
    return path
  })
  function navigate(id: AccountPathItem['id']) {
    if (id === 'root') {
      showSection(dialogRoot.value)
    } else {
      if (id === 'accounts') selectedId.value = undefined
      showSection(id)
    }
  }
  let disposed = false
  async function perform(action: () => Promise<unknown>, toastError = false): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    error.value = ''
    try {
      await action()
      if (!disposed) await runtime.refresh()
      return true
    } catch (cause) {
      // 原生清理失败也可能已停用账号；同步撤销结果，同时保留原始删除错误。
      if (!disposed) await runtime.refresh().catch(() => {})
      if (!disposed) {
        const message = cause instanceof Error ? cause.message : String(cause)
        if (toastError) removeNotice.show(message)
        else error.value = message
      }
      return false
    } finally {
      if (!disposed) busy.value = false
    }
  }
  function close() {
    open.value = false
    closeDetail()
    checks.cancelChecks()
  }
  async function add(platformId: string, name: string) {
    if (busy.value) return
    if (!supportsPlatform(platformId)) {
      error.value = '此运行端未提供该音乐源。'
      return
    }
    if (platforms.value.find((p) => p.id === platformId)?.available === false) {
      error.value = '此来源不可用，请先在插件管理中启用。'
      return
    }
    const validation = accountNameError(runtime.snapshot.value.accounts, platformId, name)
    if (validation) {
      error.value = validation
      return
    }
    showSection('add')
    const revision = navigationRevision
    await perform(async () => {
      await login.waitForCleanup()
      if (disposed || revision !== navigationRevision) return
      const account = await invoke<NativeAccount>('create_account', {
        platformId,
        name: name.trim(),
      })
      // A completed create must not replace a popup reopened while persistence was pending.
      if (!disposed && revision === navigationRevision) {
        createName.value = ''
        selectLogin(account)
      } else if (account.pending) {
        await invoke('discard_account_draft', { accountId: account.id })
      }
    })
  }
  async function update(account: NativeAccount) {
    const validation = accountNameError(
      runtime.snapshot.value.accounts,
      account.platformId,
      account.name,
      account.id,
    )
    if (validation) {
      error.value = validation
      return false
    }
    return perform(() =>
      invoke('update_account', {
        accountId: account.id,
        name: account.name.trim(),
        enabled: account.enabled,
        proxyId: account.proxyId,
        backupProxyIds: account.backupProxyIds ?? [],
      }),
    )
  }
  async function saveAccount(account: NativeAccount) {
    const current = section.value
    if (
      (await update(account)) &&
      section.value === current &&
      selectedAccount.value?.id === account.id
    )
      showSection('details')
  }
  async function remove(account: NativeAccount) {
    if (await perform(() => invoke('remove_account', { accountId: account.id }), true)) {
      if (section.value === 'details' && selectedId.value === account.id) {
        endLogin()
        selectedId.value = undefined
        showSection('accounts')
      }
    }
  }
  async function requestRemove(account: NativeAccount, confirm: ConfirmAction) {
    if (
      busy.value ||
      checks.checking.value ||
      disposed ||
      selectedAccount.value?.id !== account.id ||
      section.value !== 'details'
    )
      return
    const revision = navigationRevision
    const confirmed = await confirm({
      title: '删除账号',
      message: [
        `确定删除账号“${account.name}”吗？`,
        '删除后将清理此账号的登录状态、浏览器目录和连接设置，并中止相关请求、播放、下载及登录验证。',
        '已有歌曲、音乐列表和账号名称历史会保留；重新加载时将选择可用账号。',
      ].join('\n\n'),
      confirmLabel: '删除账号',
      tone: 'danger',
    })
    // Confirmation can outlive its account view; never execute a stale deletion.
    if (
      confirmed &&
      !disposed &&
      !busy.value &&
      !checks.checking.value &&
      revision === navigationRevision &&
      selectedAccount.value?.id === account.id &&
      section.value === 'details'
    )
      await remove(account)
  }
  async function addProxy(name: string, url: string) {
    await perform(() => invoke('save_proxy', { name, url }))
  }
  async function removeProxy(id: string) {
    await perform(() => invoke('remove_proxy', { proxyId: id }))
  }
  function handleLoginRequest(event: Event) {
    const platform = (event as CustomEvent<string>).detail
    if (!supportsPlatform(platform)) return
    open.value = true
    const requestedId = runtime.selectedAccountIds.value[platform]
    const account =
      runtime.snapshot.value.accounts.find(
        (a) => a.platformId === platform && a.id === requestedId && a.enabled,
      ) ?? runtime.snapshot.value.accounts.find((a) => a.platformId === platform && a.enabled)
    if (account) selectLogin(account)
    else startAdd(platform)
  }
  function handleStorageError() {
    error.value = '资料已保存到本机界面存储，但原生备份写入失败，请检查磁盘空间。'
    open.value = true
  }
  function handleExternalError() {
    error.value = '无法打开系统默认浏览器，请检查系统浏览器配置。'
    open.value = true
  }
  window.addEventListener('any-music:open-account-login', handleLoginRequest)
  window.addEventListener('any-music:storage-error', handleStorageError)
  window.addEventListener('any-music:external-error', handleExternalError)
  onScopeDispose(() => {
    disposed = true
    editing.dispose()
    window.removeEventListener('any-music:open-account-login', handleLoginRequest)
    window.removeEventListener('any-music:storage-error', handleStorageError)
    window.removeEventListener('any-music:external-error', handleExternalError)
  })
  return {
    get platforms() {
      return platforms.value
    },
    platformLabel: nameOf,
    ...login,
    ...checks,
    addPlatform,
    createName,
    editing,
    selectedPlatform,
    detailOpen,
    breadcrumbs,
    navigate,
    selectPlatform,
    choosePlatform,
    startAdd,
    isDialogRoot: computed(() => section.value === dialogRoot.value),
    title: computed(() =>
      section.value === 'accounts'
        ? `${nameOf(selectedPlatform.value)} · 账号管理`
        : section.value
          ? SECTION_TITLES[section.value]
          : '账号管理',
    ),
    section,
    requestRemove,
    removeNotice,
    selectedAccount,
    selectLogin,
    selectAccountDetail,
    showSection,
    closeDetail,
    back,
    open,
    busy,
    error,
    snapshot: runtime.snapshot,
    accountSummary: computed(
      () =>
        `已启用 ${runtime.snapshot.value.accounts.filter((account) => account.enabled).length} 个账号`,
    ),
    networkSummary: computed(
      () => `已配置 ${runtime.snapshot.value.proxies.length} 个代理 · 按账号分配`,
    ),
    close,
    add,
    update,
    saveAccount,
    addProxy,
    removeProxy,
  }
}
export type AccountSettingsController = ReturnType<typeof useAccountSettings>
