<script setup lang="ts">
import { ThemeHost, ThemeHostSurface } from '@any-music/plugin-ui-vue/trusted'
import { SessionBadge, createAsyncFeatureComponent } from '@any-music/ui'
import type { SettingsDetailContext, SettingsSectionId } from '@any-music/ui'
import CatalogRequestAccount from '@any-music/ui/components/music-sources/CatalogRequestAccount.vue'
import ModuleRecoveryPanel from '@any-music/ui/components/plugins/ModuleRecoveryPanel.vue'
import ResourceCacheHelpButton from '@any-music/ui/components/settings/ResourceCacheHelpButton.vue'
import ResourceCacheSettings from '@any-music/ui/components/settings/ResourceCacheSettings.vue'
import { computed, onMounted, useTemplateRef } from 'vue'

import { useResourceCacheSettings } from '../../features/settings/use-resource-cache-settings'
import { createWorkbenchThemeFeatures } from '../../features/workbench/create-workbench-theme-features'
import type {
  WorkbenchController,
  WorkbenchProps,
} from '../../features/workbench/use-workbench-controller'
import { getWorkbenchRuntime } from '../../runtime/workbench-runtime'
import NetworkProxySettingsForm from '../settings/NetworkProxySettingsForm.vue'

const props = defineProps<WorkbenchProps & { controller: WorkbenchController }>()
const emit = defineEmits<{
  selectAccount: [platformId: string]
  addAccount: [platformId: string]
}>()
defineSlots<{
  'download-settings'?: () => unknown
  'network-settings'?: () => unknown
  'account-settings'?: (context: SettingsDetailContext) => unknown
  'account-overlays'?: (context: {
    refreshSession: () => Promise<void>
    openSettings: (section?: SettingsSectionId | null) => void
    isMobileLayout: boolean
    overlayTarget?: HTMLElement | null
    suspended: boolean
  }) => unknown
}>()
const c = props.controller
const features = createWorkbenchThemeFeatures(c, props)
const runtime = getWorkbenchRuntime()
const cacheSettings = useResourceCacheSettings(
  runtime.resourceCache,
  c.confirmationDialog.confirm,
  () => c.isGlobalSettingsOpen.value && c.initialSettingsSection.value === 'cache',
)
const host = useTemplateRef('host')
const recovery = computed(() => c.modules.needsRecovery.value || c.uiTheme.needsRecovery.value)
const ExternalSourceSettings = createAsyncFeatureComponent(
  () => import('../settings/ExternalSourceSettings.vue'),
)
onMounted(() => {
  c.themeSurface.value = host.value?.getResourceRoot()
})
function drawer(id: string) {
  return c.workspace.drawers.value.find((entry) => entry.id === id)
}
</script>

<template>
  <ThemeHost
    ref="host"
    :snapshot="c.uiTheme.current.value"
    :features="features"
    :form="runtime.modules?.form ?? 'desktop'"
    :needs-recovery="recovery"
    :protected-css="runtime.protectedStyles"
    @failure="c.uiTheme.reportRenderFailure"
  >
    <template v-if="$slots['account-settings']" #account-settings="context"
      ><slot name="account-settings" v-bind="context"
    /></template>
    <template #network-settings>
      <slot name="network-settings"
        ><NetworkProxySettingsForm
          :form="c.networkProxyForm"
          :settings="c.workspace.proxySettings.value"
          @save="c.setProxySettings"
      /></slot>
    </template>
    <template v-if="$slots['download-settings']" #download-settings
      ><slot name="download-settings"
    /></template>
    <template v-if="runtime.resourceCache" #cache-settings="context">
      <ResourceCacheHelpButton
        v-if="context.placement === 'header'"
        :overlay-target="context.overlayTarget"
        :suspended="context.suspended"
        :can-choose-directory="cacheSettings.snapshot.value?.canChooseDirectory"
        :description="cacheSettings.snapshot.value?.description"
        @detail-open-change="context.detailOpenChange"
      />
      <ResourceCacheSettings
        v-else
        :snapshot="cacheSettings.snapshot.value"
        v-model:capacity-mib="cacheSettings.capacityMib.value"
        v-model:memory-capacity-mib="cacheSettings.memoryCapacityMib.value"
        :busy="cacheSettings.busy.value"
        :error="cacheSettings.error.value"
        :notice="cacheSettings.notice.value"
        @refresh="cacheSettings.refresh"
        @save="cacheSettings.save"
        @save-memory="cacheSettings.saveMemory"
        @clear="cacheSettings.clear"
        @choose-directory="cacheSettings.chooseDirectory(false)"
        @reset-directory="cacheSettings.chooseDirectory(true)"
      />
    </template>
    <template v-if="c.pluginCenter.authority.value && c.nativePluginPort" #external-source-settings>
      <ExternalSourceSettings
        :port="c.nativePluginPort"
        :authority="c.pluginCenter.authority.value"
        :tracks="c.library.records.value.map(({ track }) => ({ id: track.id, title: track.title }))"
      />
    </template>
    <template #source-identity="{ sourceId }">
      <SessionBadge
        :session="c.session.session.value"
        :refreshing="c.session.isRefreshing.value"
        :account-label="props.accountSelectionLabels?.[sourceId]"
        :switchable="props.accountSwitching?.includes(sourceId)"
        :account-missing="props.accountMissing?.includes(sourceId)"
        @select-account="emit('selectAccount', sourceId)"
        @add-account="emit('addAccount', sourceId)"
        @login="c.session.openLogin"
        @refresh="c.session.refresh"
      />
    </template>
    <template #request-account="{ drawerId }"
      ><CatalogRequestAccount
        :account="drawer(drawerId)?.account"
        :loading="drawer(drawerId)?.isLoading"
    /></template>
    <template #protected>
      <ThemeHostSurface
        v-slot="{ overlayTarget }"
        :css="runtime.protectedStyles"
        :theme="c.resolvedTheme.value"
      >
        <slot
          name="account-overlays"
          :refresh-session="c.session.refresh"
          :open-settings="c.openGlobalSettings"
          :is-mobile-layout="c.isMobileViewport.value"
          :overlay-target="overlayTarget"
          :suspended="c.isConfirmationDialogOpen.value"
        />
      </ThemeHostSurface>
    </template>
    <template #recovery>
      <ThemeHostSurface :css="runtime.protectedStyles" :theme="c.resolvedTheme.value">
        <ModuleRecoveryPanel
          :busy="c.modules.busy.value"
          :has-failure="Boolean(c.modules.failure.value)"
          @retry="c.modules.retry"
          @safe-start="c.modules.safeStart"
          @restore-default-theme="c.modules.restoreDefaultTheme"
        />
      </ThemeHostSurface>
    </template>
  </ThemeHost>
</template>
