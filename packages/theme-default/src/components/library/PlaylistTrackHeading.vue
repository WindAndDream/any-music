<script setup lang="ts">
import type { CatalogTrackDisplayMode, MobileTrackColumns } from '@any-music/ui/library'

import QueueViewControls from '../music-sources/QueueViewControls.vue'

/** Playlist details have their own action; the sticky row contains controls only. */
defineProps<{
  title: string
  arrangementMode: 'flat' | 'platform'
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  overlayTarget: HTMLElement | null
  suspended: boolean
  hideDisplay: boolean
}>()
const emit = defineEmits<{
  updateArrangementMode: [mode: 'flat' | 'platform']
  updateDisplayMode: [mode: CatalogTrackDisplayMode]
  updateMobileColumns: [columns: MobileTrackColumns]
  modalOpenChange: [open: boolean]
}>()
defineSlots<{
  navigation?: () => unknown
  actions?: () => unknown
}>()
</script>

<template>
  <header class="catalog-page__sticky-header playlist-track-heading">
    <div class="playlist-track-heading__heading" tabindex="-1" data-collection-focus>
      <div class="playlist-track-heading__controls">
        <QueueViewControls
          :collection-title="title"
          :arrangement-mode="arrangementMode"
          :display-mode="displayMode"
          :mobile-columns="mobileColumns"
          :overlay-target="overlayTarget"
          :suspended="suspended"
          :hide-display="hideDisplay"
          @update-arrangement-mode="emit('updateArrangementMode', $event)"
          @update-display-mode="emit('updateDisplayMode', $event)"
          @update-mobile-columns="emit('updateMobileColumns', $event)"
          @modal-open-change="emit('modalOpenChange', $event)"
        >
          <template v-if="$slots.navigation" #navigation><slot name="navigation" /></template>
          <template v-if="$slots.actions" #actions><slot name="actions" /></template>
        </QueueViewControls>
      </div>
    </div>
  </header>
</template>

<style scoped>
.playlist-track-heading {
  margin-inline: calc(-1 * (var(--am-catalog-page-padding) + var(--am-space-3)));
}
.playlist-track-heading__heading {
  display: grid;
  grid-template-areas: 'controls';
  grid-template-columns: minmax(0, 1fr);
  padding: var(--am-space-3) var(--am-catalog-page-padding);
  border-block-end: 1px solid var(--am-color-border);
  touch-action: pan-y;
}
.playlist-track-heading__controls {
  grid-area: controls;
  min-inline-size: 0;
}
.playlist-track-heading__controls :deep(.queue-view-controls) {
  /* The outer header owns stickiness; toolbar buttons keep their collection styles. */
  position: static;
  margin-block-end: 0;
  padding-block: 0;
  border-block-end: 0;
  background: transparent;
}
</style>
