<script setup lang="ts">
import type { SettingsDetailContext, SettingsSectionId } from '@any-music/ui'
import { provideRemoteImageResolver } from '@any-music/ui'
import { useTemplateRef } from 'vue'

import {
  useWorkbenchController,
  type WorkbenchProps,
} from '../../features/workbench/use-workbench-controller'
import { getWorkbenchRuntime } from '../../runtime/workbench-runtime'
import MusicWorkbenchThemeHost from './MusicWorkbenchThemeHost.vue'
const props = withDefaults(defineProps<WorkbenchProps>(), { presentation: 'overlay' })
provideRemoteImageResolver(getWorkbenchRuntime().resolveArtwork)
const emit = defineEmits<{
  selectAccount: [platformId: string]
  addAccount: [platformId: string]
  settingsClosed: []
}>()
defineSlots<{
  'download-settings'?: () => unknown
  'network-settings'?: () => unknown
  'account-settings'?: (context: SettingsDetailContext) => unknown
  'account-overlays'?: (props: {
    refreshSession: () => Promise<void>
    openSettings: (section?: SettingsSectionId | null) => void
    isMobileLayout: boolean
    overlayTarget?: HTMLElement | null
    suspended: boolean
  }) => unknown
}>()
const audio = useTemplateRef<HTMLAudioElement>('audio')
const controller = useWorkbenchController(props, () => emit('settingsClosed'), audio)
const { player } = controller
defineExpose({
  openSettings: controller.openGlobalSettings,
  refreshSession: () => controller.session.refresh(),
})
</script>
<template>
  <!-- The media element and its controller outlive every replaceable presentation root. -->
  <audio
    ref="audio"
    hidden
    :loop="
      !controller.previewTrack.value &&
      controller.queue.mode.value === 'repeat-one' &&
      !player.isControlledCustomPlayback.value
    "
    @durationchange="player.updateNativeMediaState"
    @loadedmetadata="player.handleLoadedMetadata"
    @progress="player.updateNativeMediaState"
    @seeking="player.handleNativeSeeking"
    @seeked="player.handleNativeSeeked"
    @timeupdate="player.handleTimeUpdate"
    @play="player.handleNativePlay"
    @playing="player.handleNativePlaying"
    @pause="player.handleNativePause"
    @ended="player.handleEnded"
    @error="player.handleMediaError"
  ></audio>
  <MusicWorkbenchThemeHost
    v-bind="props"
    :controller="controller"
    @select-account="emit('selectAccount', $event)"
    @add-account="emit('addAccount', $event)"
  >
    <template v-if="$slots['download-settings']" #download-settings
      ><slot name="download-settings"
    /></template>
    <template v-if="$slots['network-settings']" #network-settings
      ><slot name="network-settings"
    /></template>
    <template v-if="$slots['account-settings']" #account-settings="context"
      ><slot name="account-settings" v-bind="context"
    /></template>
    <template v-if="$slots['account-overlays']" #account-overlays="context"
      ><slot name="account-overlays" v-bind="context"
    /></template>
  </MusicWorkbenchThemeHost>
</template>
