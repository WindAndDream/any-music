<script setup lang="ts">
import { useDestinationReorder } from '@any-music/ui'
import type { ProductDestination } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'

interface Props {
  destinations: readonly ProductDestination[]
  hiddenDestinationIds: readonly ProductDestination['id'][]
  /** 壳层确定移动布局后移除上下按钮，保留同一手柄的触摸和键盘排序。 */
  isMobileLayout?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  setDestinationVisible: [id: ProductDestination['id'], isVisible: boolean]
  moveDestination: [id: ProductDestination['id'], offset: -1 | 1]
}>()

/**
 * The list owns only reorder presentation and input handling. The parent remains the controlled
 * source of truth and persists each requested move through the runtime-specific repository.
 */
const {
  displayedDestinations,
  draggedDestinationId,
  keyboardGrabbedId,
  announcement,
  startPointerReorder,
  updatePointerReorder,
  commitPointerReorder,
  cancelPointerReorder,
  handleLostPointerCapture,
  handleReorderKeydown,
  getDestinationStyle,
  isDestinationShifted,
} = useDestinationReorder({
  destinations: () => props.destinations,
  moveDestination: (id, offset) => emit('moveDestination', id, offset),
})

function getDragHandleLabel(destination: ProductDestination): string {
  if (keyboardGrabbedId.value === destination.id) {
    return `正在排序 ${destination.label}；使用上下方向键移动，空格或回车完成`
  }
  return `拖动 ${destination.label} 排序；键盘按空格或回车后使用上下方向键移动`
}

function isDestinationVisible(id: ProductDestination['id']): boolean {
  return !props.hiddenDestinationIds.includes(id)
}

function toggleDestinationVisibility(destination: ProductDestination): void {
  emit('setDestinationVisible', destination.id, !isDestinationVisible(destination.id))
}
</script>

<template>
  <p id="am-destination-order-instructions" class="am-sr-only">
    按住每一项的拖动把手可调整顺序。键盘用户可在把手上按空格或回车，再用上下方向键移动。
  </p>
  <p class="am-sr-only" aria-live="polite" aria-atomic="true">{{ announcement }}</p>

  <TransitionGroup
    tag="ol"
    name="am-destination"
    class="navigation-order"
    :class="{
      'navigation-order--dragging': draggedDestinationId !== undefined,
      'navigation-order--mobile': props.isMobileLayout,
    }"
    aria-describedby="am-destination-order-instructions"
  >
    <li
      v-for="(destination, index) in displayedDestinations"
      :key="destination.id"
      :data-destination-id="destination.id"
      :aria-posinset="index + 1"
      :aria-setsize="displayedDestinations.length"
    >
      <div
        class="navigation-order__item"
        :class="{
          'navigation-order__item--dragging': draggedDestinationId === destination.id,
          'navigation-order__item--shifted': isDestinationShifted(destination.id),
        }"
        :style="getDestinationStyle(destination.id)"
      >
        <button
          class="navigation-order__drag-handle"
          type="button"
          :aria-label="getDragHandleLabel(destination)"
          :data-keyboard-grabbed="keyboardGrabbedId === destination.id ? 'true' : undefined"
          title="按住拖动排序；键盘按空格后用方向键调整"
          @click.prevent
          @pointerdown="startPointerReorder($event, destination.id)"
          @pointermove="updatePointerReorder"
          @pointerup="commitPointerReorder"
          @pointercancel="cancelPointerReorder"
          @lostpointercapture="handleLostPointerCapture"
          @keydown="handleReorderKeydown($event, destination.id)"
        >
          <AppIcon name="drag" />
        </button>

        <div class="navigation-order__main">
          <AppIcon :name="destination.icon" />
          <span class="navigation-order__label">{{ destination.label }}</span>
        </div>
        <button
          v-if="destination.canHide"
          class="navigation-order__visibility"
          type="button"
          :data-visible="isDestinationVisible(destination.id) ? 'true' : 'false'"
          :aria-pressed="isDestinationVisible(destination.id)"
          :aria-label="`${isDestinationVisible(destination.id) ? '隐藏' : '显示'} ${destination.label}`"
          :title="
            isDestinationVisible(destination.id) ? '点击后从导航中隐藏' : '点击后在导航中显示'
          "
          @click="toggleDestinationVisibility(destination)"
        >
          <AppIcon :name="isDestinationVisible(destination.id) ? 'check' : 'hide'" :size="16" />
          <span>{{ isDestinationVisible(destination.id) ? '显示中' : '已隐藏' }}</span>
        </button>
        <span v-else class="navigation-order__required">
          <AppIcon name="check" :size="16" />
          固定显示
        </span>
        <div v-if="!props.isMobileLayout" class="navigation-order__move-actions">
          <button
            type="button"
            :disabled="index === 0"
            :aria-label="`上移 ${destination.label}`"
            @click="emit('moveDestination', destination.id, -1)"
          >
            <AppIcon name="arrow-up" />
          </button>
          <button
            type="button"
            :disabled="index === displayedDestinations.length - 1"
            :aria-label="`下移 ${destination.label}`"
            @click="emit('moveDestination', destination.id, 1)"
          >
            <AppIcon name="arrow-down" />
          </button>
        </div>
      </div>
    </li>
  </TransitionGroup>
</template>

<style scoped>
.navigation-order {
  display: grid;
  gap: var(--am-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.navigation-order__item {
  /* 外层 li 专供 TransitionGroup 落位；拖拽预览使用内层，避免双方覆写 transform。 */
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--am-space-3);
  min-block-size: 48px;
  padding: var(--am-space-2) var(--am-space-3) var(--am-space-2) var(--am-space-2);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface);
  transition:
    transform var(--am-motion-normal) var(--am-ease-emphasized),
    border-color var(--am-motion-fast) var(--am-ease-standard),
    box-shadow var(--am-motion-fast) var(--am-ease-standard),
    opacity var(--am-motion-fast) var(--am-ease-standard);
}

.navigation-order--dragging .navigation-order__item {
  user-select: none;
}

.navigation-order__item--dragging {
  z-index: 1;
  border-color: var(--am-color-primary);
  box-shadow: var(--am-shadow-card);
  opacity: 0.96;
  transition:
    border-color var(--am-motion-fast) var(--am-ease-standard),
    box-shadow var(--am-motion-fast) var(--am-ease-standard),
    opacity var(--am-motion-fast) var(--am-ease-standard);
}

.navigation-order__item--shifted {
  will-change: transform;
}

.navigation-order__drag-handle,
.navigation-order__move-actions button {
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-control);
  color: var(--am-color-text);
}

.navigation-order__drag-handle {
  inline-size: 32px;
  block-size: 32px;
  background: transparent;
  color: var(--am-color-text-secondary);
  cursor: grab;
  touch-action: none;
}

.navigation-order__drag-handle:hover,
.navigation-order__drag-handle[data-keyboard-grabbed='true'] {
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}

.navigation-order__drag-handle:active,
.navigation-order__item--dragging .navigation-order__drag-handle {
  cursor: grabbing;
}

.navigation-order__main {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-3);
}

.navigation-order__label {
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.navigation-order__visibility,
.navigation-order__required {
  display: inline-flex;
  min-inline-size: 92px;
  block-size: var(--am-size-control);
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-weight: 700;
  white-space: nowrap;
}

.navigation-order__visibility {
  cursor: pointer;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    border-color var(--am-motion-fast) var(--am-ease-standard),
    color var(--am-motion-fast) var(--am-ease-standard),
    transform var(--am-motion-fast) var(--am-ease-standard);
}

.navigation-order__visibility[data-visible='true'] {
  border-color: transparent;
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}

.navigation-order__visibility:hover {
  border-color: var(--am-color-primary);
  color: var(--am-color-primary);
}

.navigation-order__visibility:active {
  transform: scale(0.98);
}

.navigation-order__move-actions {
  display: grid;
  /* 桌面两枚方向按钮共享宽阔的操作面，不再呈现狭窄的图标条。 */
  grid-template-columns: repeat(2, 64px);
  overflow: hidden;
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface-subtle);
}

.navigation-order__move-actions button {
  inline-size: 64px;
  block-size: var(--am-size-control);
  border-radius: 0;
  background: transparent;
  color: var(--am-color-text-secondary);
  cursor: pointer;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    color var(--am-motion-fast) var(--am-ease-standard);
}

.navigation-order__move-actions button + button {
  border-inline-start: 1px solid var(--am-color-border);
}

.navigation-order__move-actions button:hover:not(:disabled) {
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}

.navigation-order__move-actions button:disabled {
  opacity: 0.36;
  cursor: not-allowed;
}

.am-destination-move {
  transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
}

.navigation-order--mobile .navigation-order__item {
  /* 移动布局一行保留手柄、名称和右侧状态；文字换行也不拉高手柄。 */
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: var(--am-space-2);
  padding: var(--am-space-2);
}

.navigation-order--mobile .navigation-order__drag-handle {
  inline-size: 44px;
  block-size: 44px;
  align-self: center;
  border: 1px solid var(--am-color-border);
  background: var(--am-color-surface-subtle);
}

.navigation-order--mobile .navigation-order__main {
  gap: var(--am-space-2);
}

.navigation-order--mobile .navigation-order__main > :first-child {
  flex: 0 0 auto;
}

.navigation-order--mobile .navigation-order__visibility,
.navigation-order--mobile .navigation-order__required {
  justify-self: end;
  min-block-size: 44px;
}

@container am-bottom-sheet (max-width: 360px) {
  .navigation-order__visibility,
  .navigation-order__required {
    min-inline-size: 80px;
    gap: var(--am-space-1);
    padding-inline: var(--am-space-2);
  }
}

@media (prefers-reduced-motion: reduce) {
  .navigation-order__item,
  .navigation-order__visibility,
  .am-destination-move {
    transition-duration: 1ms;
  }
}
</style>
