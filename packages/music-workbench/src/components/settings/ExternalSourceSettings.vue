<script setup lang="ts">
import NativePluginAuthorityPanel from '@any-music/ui/components/plugins/NativePluginAuthorityPanel.vue'

import type {
  useNativePluginAuthority,
  NativePluginAuthorityPort,
} from '../../features/plugins/use-native-plugin-authority'

/** Fixed host panel consumes the same native session as the plugin center. */
const props = defineProps<{
  port: NativePluginAuthorityPort
  authority: ReturnType<typeof useNativePluginAuthority>
  tracks: readonly { id: string; title: string }[]
}>()
</script>

<template>
  <NativePluginAuthorityPanel
    :installs="authority.installs.value"
    :busy="authority.busy.value"
    :error-message="authority.errorMessage.value"
    :preview-supported="!!props.port.previewPackage"
    :package-preview="authority.packagePreview.value"
    :native-picker-supported="!!props.port.pickPackage"
    :remote-supported="!!props.port.previewPackageUrl"
    :dev-supported="!!props.port.beginDev"
    :dev-pairing-path="authority.devPairingPath.value"
    :tracks="props.tracks"
    :result="authority.result.value"
    :diagnostics="authority.diagnostics.value"
    @install="authority.install"
    @rollback="authority.rollback"
    @execute="authority.execute"
    @save-result="authority.saveResult"
    @refresh-diagnostics="authority.refreshDiagnostics"
    @export-diagnostics="authority.exportDiagnostics"
    @refresh="authority.refresh"
    @revoke="authority.revoke"
    @select-file="authority.selectPackageFile"
    @clear-preview="authority.clearPackagePreview"
    @choose-native="authority.chooseNativePackage"
    @preview-url="authority.previewPackageUrl"
    @begin-dev="authority.beginDev"
    @end-dev="authority.endDev"
  />
</template>
