<script setup lang="ts">
import MusicSourceWorkbench from '@any-music/music-workbench/components/music-sources/MusicSourceWorkbench.vue'
import { AppToast, provideBackNavigation, provideTrackAccountName } from '@any-music/ui'
import { computed, useTemplateRef, watch } from 'vue'

import AccountSettingsOverlay from './components/accounts/AccountSettingsOverlay.vue'
import AccountSettingsPanel from './components/accounts/AccountSettingsPanel.vue'
import AccountSwitchDialog from './components/accounts/AccountSwitchDialog.vue'
import ProxySettingsPanel from './components/accounts/ProxySettingsPanel.vue'
import DownloadDirectorySettings from './components/downloads/DownloadDirectorySettings.vue'
import { accountStatus } from './features/accounts/account-presentation'
import type { AccountPlatform } from './features/accounts/source-authentication'
import { useAccountSettings } from './features/accounts/use-account-settings'
import { useAccountSwitcher } from './features/accounts/use-account-switcher'
import { getBuiltInSourceDirectory } from './features/music-sources/built-in-source-directory'
import { accountRuntime, getNativeRuntimeCapabilities } from './platform/configure-tauri-workbench'
import { useAndroidBackNavigation } from './platform/use-android-back-navigation'
const nativeCapabilities = getNativeRuntimeCapabilities()
const backNavigation =
  nativeCapabilities.platform === 'android' ? provideBackNavigation() : undefined
const exitNotice = useAndroidBackNavigation(backNavigation)
const hasAccountTransport = nativeCapabilities.accountTransport === 'provided'
const builtInPlatforms = getBuiltInSourceDirectory(nativeCapabilities.form).map(
  ({ descriptor }) => ({
    id: descriptor.id,
    name: descriptor.name,
  }),
)
const sourcePlatforms = computed<readonly AccountPlatform[]>(() => [
  ...builtInPlatforms,
  ...accountRuntime.sourcePlatforms.value,
])
const settings = useAccountSettings(accountRuntime, sourcePlatforms)
provideTrackAccountName(accountRuntime.getTrackAccountName)
const switcher = useAccountSwitcher(accountRuntime, () =>
  sourcePlatforms.value.map((platform) => platform.id),
)
const workbench = useTemplateRef('workbench')
const missingAccountSources = computed(() =>
  sourcePlatforms.value
    .filter(
      (source) =>
        !accountRuntime.snapshot.value.accounts.some((account) => account.platformId === source.id),
    )
    .map((source) => source.pluginId ?? source.id),
)
const accountStatuses = computed(() =>
  Object.fromEntries(
    accountRuntime.snapshot.value.accounts.map((account) => [account.id, accountStatus(account)]),
  ),
)
const accountSelectionLabels = computed(() =>
  Object.fromEntries(
    sourcePlatforms.value.map((source) => [
      source.pluginId ?? source.id,
      accountRuntime.snapshot.value.accounts.find(
        (account) => account.id === accountRuntime.selectedAccountIds.value[source.id],
      )?.name ?? '随机',
    ]),
  ),
)
watch(settings.open, (open) => {
  if (open) {
    workbench.value?.openSettings('accounts')
    void accountRuntime.refreshSourcePlatforms().catch(() => {})
  }
})
watch(settings.detailOpen, (open, wasOpen) => {
  if (wasOpen && !open) void workbench.value?.refreshSession()
})
function handleSettingsClosed() {
  const hadAccountDialog = settings.detailOpen.value
  settings.close()
  if (!hadAccountDialog) void workbench.value?.refreshSession()
}
function manageAccounts(openSettings: (section: 'accounts') => void) {
  switcher.close()
  openSettings('accounts')
}
function selectSourceAccount(sourceId: string) {
  void switcher.open(
    sourcePlatforms.value.find((source) => source.pluginId === sourceId)?.id ?? sourceId,
  )
}
function addSourceAccount(sourceId: string) {
  const platformId =
    sourcePlatforms.value.find((source) => source.pluginId === sourceId)?.id ?? sourceId
  settings.startAdd(platformId, { standalone: true })
}
</script>
<template>
  <div class="native-app am-root">
    <main class="native-content">
      <MusicSourceWorkbench
        ref="workbench"
        presentation="embedded"
        :account-switching="
          hasAccountTransport
            ? sourcePlatforms.map((platform) => platform.pluginId ?? platform.id)
            : []
        "
        :account-selection-labels="accountSelectionLabels"
        :account-statuses="accountStatuses"
        :account-missing="hasAccountTransport ? missingAccountSources : []"
        :account-dialog-open="switcher.platformId.value !== null || settings.detailOpen.value"
        :account-summary="settings.accountSummary.value"
        :network-summary="settings.networkSummary.value"
        network-title="代理管理"
        network-description="保存代理，在账号的请求连接中选择主代理和备用代理。"
        @select-account="selectSourceAccount"
        @add-account="addSourceAccount"
        @settings-closed="handleSettingsClosed"
      >
        <template #account-settings="context"
          ><AccountSettingsPanel
            v-if="hasAccountTransport"
            :settings="settings"
            :detail-open-change="context.detailOpenChange"
          />
          <p v-else role="status">此运行端暂不支持来源登录与请求，已保存的资料仍可管理。</p>
        </template>
        <template #network-settings>
          <ProxySettingsPanel
            v-if="hasAccountTransport && nativeCapabilities.accountProxy === 'provided'"
            :proxies="settings.snapshot.value.proxies"
            :accounts="settings.snapshot.value.accounts"
            :busy="settings.busy.value"
            :error="settings.error.value"
            @add="settings.addProxy"
            @remove="settings.removeProxy"
          />
          <p v-else role="status">此运行端暂不支持账号代理。</p>
        </template>
        <template #download-settings>
          <DownloadDirectorySettings
            v-if="nativeCapabilities.nativeSave === 'provided'"
            :platform="nativeCapabilities.platform"
          />
          <p v-else role="status">此运行端暂不支持下载目录选择与文件保存。</p>
        </template>
        <template #account-overlays="{ refreshSession, openSettings, ...context }">
          <AccountSettingsOverlay
            v-if="hasAccountTransport"
            :settings="settings"
            v-bind="context"
          />
          <AppToast :message="exitNotice.message.value" tone="info" />
          <AppToast
            :message="settings.removeNotice.message.value"
            tone="error"
            @pause-change="settings.removeNotice.setPaused"
          />
          <AccountSwitchDialog
            :platform-id="switcher.platformId.value"
            :accounts="switcher.accounts.value"
            :user-names="accountRuntime.sessionUserNames.value"
            :proxies="settings.snapshot.value.proxies"
            :selected-id="switcher.selectedId.value"
            :busy="switcher.busy.value"
            :error="switcher.error.value"
            @select="switcher.select($event, refreshSession)"
            @close="switcher.close"
            @refresh="switcher.refresh(refreshSession)"
            @manage="manageAccounts(openSettings)"
          />
        </template>
      </MusicSourceWorkbench>
    </main>
  </div>
</template>
