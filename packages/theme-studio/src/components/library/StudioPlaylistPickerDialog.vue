<script setup lang="ts">
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import { useEditingSession, provideEditingSession } from '@any-music/ui/library'
import type { PlaylistPickerProps } from '@any-music/ui/library'
import { shallowRef, watch } from 'vue'

import StudioPlaylistPicker from './StudioPlaylistPicker.vue'

const props = defineProps<PlaylistPickerProps & { overlayTarget?: HTMLElement | null }>()
const pickerModalTarget = shallowRef<HTMLElement | null>(null)
const emit = defineEmits<{ close: []; select: [playlistIds: readonly string[]] }>()
const modalOpen = shallowRef(false)
const editing = useEditingSession('playlist-addition')
provideEditingSession(editing)
function reset() {
  editing.clearScope('playlist-picker')
  editing.clearScope('playlist-picker-panel')
  editing.clearScope('studio-playlist-picker-panel')
}
watch(
  () => props.open,
  (open) => {
    if (!open) reset()
  },
  { flush: 'sync' },
)
function close() {
  reset()
  emit('close')
}
</script>

<template>
  <Teleport :to="props.overlayTarget ?? 'body'" :disabled="!props.overlayTarget">
    <AppDialog
      :open="open"
      title="添加歌单"
      :description="`将已选的 ${selectedCount} 首歌曲加入勾选的歌单。`"
      :suspended="suspended || modalOpen"
      @close="close"
    >
      <StudioPlaylistPicker
        v-bind="props"
        :overlay-target="pickerModalTarget"
        @select="emit('select', $event)"
        @back="close"
        @modal-open-change="modalOpen = $event"
      />
      <template #overlays><div ref="pickerModalTarget" /></template>
    </AppDialog>
  </Teleport>
</template>
