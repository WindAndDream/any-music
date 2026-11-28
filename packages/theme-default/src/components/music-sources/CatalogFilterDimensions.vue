<script setup lang="ts">
import { useCatalogOperatorScroll } from '@any-music/ui/catalog'
import { nextTick, onMounted, useTemplateRef } from 'vue'

import CatalogScrollArrow from './CatalogScrollArrow.vue'

const props = defineProps<{ label: string; initialScrollLeft?: number }>()
defineSlots<{ default(): unknown }>()

const container = useTemplateRef<HTMLElement>('container')
const viewport = useTemplateRef<HTMLElement>('viewport')
const content = useTemplateRef<HTMLElement>('content')

const { hasOverflow, isAtEnd, updateScroll, advance } = useCatalogOperatorScroll({
  container,
  viewport,
  content,
})
onMounted(async () => {
  if (!props.initialScrollLeft) return
  // 箭头占位后，可恢复的滚动距离才完整。
  await nextTick()
  if (!viewport.value) return
  viewport.value.scrollLeft = props.initialScrollLeft
  updateScroll()
})
defineExpose({ getScrollLeft: () => viewport.value?.scrollLeft ?? 0 })
</script>

<template>
  <nav
    ref="container"
    class="catalog-filter-dimensions"
    :class="{ 'catalog-filter-dimensions--overflow': hasOverflow }"
    :aria-label="label"
  >
    <div ref="viewport" class="catalog-filter-dimensions__viewport" @scroll="updateScroll">
      <div ref="content" class="catalog-filter-dimensions__content"><slot /></div>
    </div>
    <CatalogScrollArrow
      v-if="hasOverflow"
      class="catalog-filter-dimensions__advance"
      :at-end="isAtEnd"
      forward-label="查看更多筛选项"
      back-label="返回前面的筛选项"
      @advance="advance"
    />
  </nav>
</template>

<style scoped>
.catalog-filter-dimensions {
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  min-block-size: 0;
  padding-inline-end: var(--am-space-5);
  border-inline-end: 1px solid var(--am-color-border);
}

.catalog-filter-dimensions__viewport {
  overflow-y: auto;
}

.catalog-filter-dimensions__content {
  position: relative;
  display: grid;
  align-content: start;
  gap: var(--am-space-2);
}

.catalog-filter-dimensions > .catalog-filter-dimensions__advance {
  display: none;
}

@container am-bottom-sheet (max-width: 760px) {
  .catalog-filter-dimensions {
    grid-row: 2;
    align-items: center;
    padding: var(--am-space-3) 0 0;
    border-inline-end: 0;
    border-block-start: 1px solid var(--am-color-border);
  }

  .catalog-filter-dimensions--overflow {
    grid-template-columns: minmax(0, 1fr) 44px;
    column-gap: var(--am-space-1);
  }

  .catalog-filter-dimensions__viewport {
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-inline: contain;
    scroll-snap-type: inline proximity;
    scrollbar-width: none;
    touch-action: pan-x;
  }

  .catalog-filter-dimensions__viewport::-webkit-scrollbar {
    display: none;
  }

  .catalog-filter-dimensions__content {
    display: flex;
    inline-size: max-content;
  }

  .catalog-filter-dimensions > .catalog-filter-dimensions__advance {
    display: grid;
  }
}
</style>
