<script setup lang="ts">
import { useTemplateRef } from 'vue'

import { useGridMoveTransition } from '../../composables/music-sources/use-grid-move-transition'
import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
  TrackGridViewport,
} from './catalog-track-display-mode'

/** Controlled grid geometry and keyed movement; card skins belong to the consuming theme. */
const props = defineProps<{
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  /** A results list in a child WebView follows the main window's breakpoint. */
  viewportSize?: TrackGridViewport
  animate?: boolean
  /** Stable keys in slot element order; density/column changes share the same batched movement. */
  itemKeys?: readonly string[]
}>()
defineSlots<{ default(): unknown }>()
useGridMoveTransition({
  element: useTemplateRef<HTMLElement>('items'),
  itemKeys: () => props.itemKeys ?? [],
  layoutKey: () => `${props.displayMode}:${props.mobileColumns}`,
  enabled: () => Boolean(props.animate),
})
</script>
<template>
  <div class="list">
    <div
      ref="items"
      class="list__items"
      :data-display-mode="displayMode"
      :data-mobile-columns="mobileColumns"
      :data-viewport-size="viewportSize"
    >
      <slot />
    </div>
  </div>
</template>
<style scoped>
.list {
  container: am-track-list / inline-size;
  min-inline-size: 0;
  min-block-size: 0;
  padding: 0;
}
.list__items {
  display: grid;
  --am-track-mobile-columns: minmax(0, 1fr);
  --am-track-card-min-width: 296px;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--am-track-card-min-width)), 1fr));
  gap: var(--am-space-3);
}
.list__items[data-display-mode='comfortable'] {
  --am-track-card-min-width: 420px;
  --am-track-card-artwork-max-height: 240px;
}
.list__items[data-display-mode='compact'] {
  --am-track-card-min-width: 224px;
}
.list__cell {
  container: am-track-card / inline-size;
  display: grid;
  min-inline-size: 0;
}
.list__items[data-mobile-columns='2'] {
  --am-track-mobile-columns: repeat(2, minmax(0, 1fr));
  --am-track-mobile-gap: var(--am-space-2);
}
.list__items[data-viewport-size='narrow'] {
  grid-template-columns: var(--am-track-mobile-columns);
  gap: var(--am-track-mobile-gap, var(--am-space-3));
}
@media (max-width: 600px) {
  .list__items:not([data-viewport-size]) {
    grid-template-columns: var(--am-track-mobile-columns);
    gap: var(--am-track-mobile-gap, var(--am-space-3));
  }
}
</style>
