<script setup lang="ts" generic="T">
import { computed, onScopeDispose, useTemplateRef, watch } from 'vue'
import type { CSSProperties } from 'vue'

import type { MeasuredVirtualGridItem } from '../../composables/virtual-scroll/use-measured-virtual-grid'
import type { VirtualItemKey } from '../../composables/virtual-scroll/virtual-row-geometry'

const props = defineProps<{
  row: MeasuredVirtualGridItem<T>
  count: number
  gridRow: number
  observe: (key: VirtualItemKey, element: HTMLElement) => () => void
  registerMotion: (key: VirtualItemKey, slot: HTMLElement, surface: HTMLElement) => () => void
  registerInteraction?: (key: VirtualItemKey, element: HTMLElement) => () => void
  interactionGeneration?: number
  reorder?: {
    attributePrefix: string
    kind: string
    id: string
    style?: CSSProperties
  }
}>()
defineSlots<{ default(props: { row: MeasuredVirtualGridItem<T> }): unknown }>()
const content = useTemplateRef<HTMLElement>('content')
const cell = useTemplateRef<HTMLElement>('cell')
const flip = useTemplateRef<HTMLElement>('flip')
const reorderAttributes = computed(() =>
  props.reorder
    ? {
        [`data-${props.reorder.attributePrefix}-drop-kind`]: props.reorder.kind,
        [`data-${props.reorder.attributePrefix}-drop-id`]: props.reorder.id,
      }
    : {},
)
let release: (() => void) | undefined
watch(
  [content, () => props.row.key],
  ([element, key]) => {
    release?.()
    release = element ? props.observe(key, element) : undefined
  },
  { immediate: true, flush: 'post' },
)
onScopeDispose(() => release?.())
let releaseMotion: (() => void) | undefined
watch(
  [cell, flip, () => props.row.key],
  ([slot, surface, key]) => {
    releaseMotion?.()
    releaseMotion = slot && surface ? props.registerMotion(key, slot, surface) : undefined
  },
  { immediate: true, flush: 'post' },
)
onScopeDispose(() => releaseMotion?.())
let releaseInteraction: (() => void) | undefined
watch(
  [cell, () => props.row.key, () => props.registerInteraction, () => props.interactionGeneration],
  ([element, key, register]) => {
    releaseInteraction?.()
    releaseInteraction = element && register ? register(key, element) : undefined
  },
  { immediate: true, flush: 'post' },
)
onScopeDispose(() => releaseInteraction?.())
</script>

<template>
  <div
    ref="cell"
    class="list__cell virtual-grid-cell"
    v-bind="reorderAttributes"
    role="listitem"
    :data-occurrence="row.key"
    :aria-posinset="row.index + 1"
    :aria-setsize="count"
    :style="{ gridRowStart: gridRow, gridColumnStart: row.columnIndex + 1 }"
  >
    <div ref="content" class="virtual-grid-cell__content">
      <div ref="flip" class="virtual-grid-cell__flip">
        <div
          class="virtual-grid-cell__motion"
          :data-am-grid-motion="reorder ? '' : undefined"
          :style="reorder?.style"
        >
          <slot :row="row" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.virtual-grid-cell {
  display: grid;
  container: am-track-card / inline-size;
  min-inline-size: 0;
  content-visibility: visible;
  contain: none;
}
.virtual-grid-cell__content,
.virtual-grid-cell__flip,
.virtual-grid-cell__motion {
  display: grid;
  min-inline-size: 0;
}
.virtual-grid-cell__motion[data-am-grid-motion] {
  transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
}
.virtual-grid-cell[data-am-grid-source] .virtual-grid-cell__motion {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .virtual-grid-cell__motion[data-am-grid-motion] {
    transition: none;
  }
}
/* Container-query cells form stacking contexts; elevate the stable slot, not its child. */
.virtual-grid-cell[data-am-grid-source],
.virtual-grid-cell[data-am-grid-landing] {
  position: relative;
  z-index: 3;
}
</style>
