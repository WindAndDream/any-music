<script setup lang="ts">
import type { CatalogDrawerStateFilter } from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'

import CatalogOperatorActions from './CatalogOperatorActions.vue'

/** 状态、发现入口和会话的受控吸顶区；列表请求与筛选结果由父级管理。 */
const props = defineProps<{
  stateFilter: CatalogDrawerStateFilter
  totalCount: number
  availableCount: number
  unavailableCount: number
  attentionCount: number
  discoveryLabel: string
  discoveryInHeader: boolean
}>()
const emit = defineEmits<{
  'update:stateFilter': [value: CatalogDrawerStateFilter]
  discover: []
}>()
defineSlots<{
  session?: () => unknown
  'title-actions'?: () => unknown
}>()
const stateOrder: readonly CatalogDrawerStateFilter[] = [
  'all',
  'available',
  'unavailable',
  'attention',
]
</script>

<template>
  <header class="catalog-drawers__header" :data-empty="props.totalCount === 0">
    <div class="catalog-drawers__intro">
      <div v-if="!props.discoveryInHeader && $slots.session" class="catalog-drawers__session">
        <slot name="session" />
      </div>
      <div class="catalog-drawers__heading">
        <div v-if="props.discoveryInHeader && $slots.session" class="catalog-drawers__session">
          <slot name="session" />
        </div>
        <h2 v-else>
          发现
          <span class="catalog-drawers__count"
            ><strong>{{ props.totalCount }}</strong> 个</span
          >
        </h2>
      </div>
      <p class="catalog-drawers__description">
        搜索和导入内容会保留在这里，查看歌曲后向下滚动即可继续加载。
      </p>
    </div>
    <div class="catalog-drawers__state-toolbar">
      <CatalogOperatorActions
        v-if="props.totalCount > 0"
        class="catalog-drawers__states"
        role="group"
        aria-label="音乐列表状态筛选"
        align="start"
        forward-label="查看更多列表状态"
        back-label="返回前面的列表状态"
      >
        <div
          class="catalog-drawers__state-options"
          :style="{ '--am-state-tab-index': stateOrder.indexOf(props.stateFilter) }"
        >
          <button
            type="button"
            :aria-pressed="props.stateFilter === 'all'"
            @click="emit('update:stateFilter', 'all')"
          >
            全部 {{ props.totalCount }}
          </button>
          <button
            type="button"
            :aria-pressed="props.stateFilter === 'available'"
            @click="emit('update:stateFilter', 'available')"
          >
            可用 {{ props.availableCount }}
          </button>
          <button
            type="button"
            :aria-pressed="props.stateFilter === 'unavailable'"
            @click="emit('update:stateFilter', 'unavailable')"
          >
            不可用 {{ props.unavailableCount }}
          </button>
          <button
            type="button"
            :aria-pressed="props.stateFilter === 'attention'"
            @click="emit('update:stateFilter', 'attention')"
          >
            错误 {{ props.attentionCount }}
          </button>
        </div>
      </CatalogOperatorActions>
      <div
        v-if="props.discoveryInHeader || $slots['title-actions']"
        class="catalog-drawers__title-actions"
      >
        <button
          v-if="props.discoveryInHeader"
          class="catalog-drawers__discover"
          type="button"
          aria-haspopup="dialog"
          @click="emit('discover')"
        >
          <AppIcon name="search" :size="16" />
          <span>{{ props.discoveryLabel }}</span>
        </button>
        <slot name="title-actions" />
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
@use '../../styles/collection-chrome';
.catalog-drawers__header {
  /* 桌面介绍随内容滚出，工具栏独立吸顶；移动端把两行组合为一个吸顶区。 */
  display: contents;
}
.catalog-drawers__intro {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-1);
}
.catalog-drawers__heading,
.catalog-drawers__session {
  min-inline-size: 0;
}
.catalog-drawers__heading h2 {
  display: flex;
  min-block-size: 44px;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--am-space-3);
  margin: 0;
  color: var(--am-color-text);
  font-size: var(--am-font-size-md);
  letter-spacing: -0.025em;
}
.catalog-drawers__count {
  display: inline-flex;
  align-items: baseline;
  gap: var(--am-space-1);
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
  font-size: var(--am-font-size-sm);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.catalog-drawers__count strong {
  font-size: var(--am-font-size-lg);
  font-weight: 750;
}
.catalog-drawers__description {
  margin: var(--am-space-2) 0 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  line-height: 1.6;
}
.catalog-drawers__state-toolbar {
  position: sticky;
  z-index: var(--am-z-sticky);
  inset-block-start: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--am-space-3);
  min-inline-size: 0;
  padding-block: var(--am-space-2);
  background: var(--am-color-surface-subtle);
  border-block-end: 1px solid var(--am-color-border);
}
.catalog-drawers__title-actions {
  grid-column: 2;
  display: flex;
  min-inline-size: 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--am-space-2);
}
.catalog-drawers__discover {
  display: inline-flex;
  min-block-size: 44px;
  min-inline-size: 0;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-primary);
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  cursor: pointer;
  font: 650 var(--am-font-size-xs) var(--am-font-family);
  touch-action: manipulation;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    border-color var(--am-motion-fast) var(--am-ease-standard);
}
.catalog-drawers__discover span {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.catalog-drawers__discover:is(:hover, :focus-visible):not(:disabled) {
  border-color: var(--am-color-primary-hover);
  background: var(--am-color-primary-hover);
}
.catalog-drawers__discover .app-icon {
  flex-shrink: 0;
  transition: transform var(--am-motion-fast) var(--am-ease-emphasized);
}
@media (prefers-reduced-motion: no-preference) {
  .catalog-drawers__discover:is(:hover, :focus-visible):not(:disabled) .app-icon {
    transform: scale(1.12) rotate(-8deg);
  }
}
.catalog-drawers__states {
  --am-operator-actions-background: var(--am-color-surface-subtle);
  min-inline-size: 0;
}
.catalog-drawers__states :deep(.catalog-operator-actions__content) {
  gap: var(--am-space-1);
}
.catalog-drawers__state-options {
  @include collection-chrome.state-tabs(4);
}
.catalog-drawers__states button:focus-visible,
.catalog-drawers__discover:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: calc(-1 * var(--am-focus-offset));
}
@media (min-width: 769px) {
  .catalog-drawers__header[data-empty='true'] {
    /* 仅全部列表为空时合并介绍与入口；筛选无匹配仍保留完整状态工具栏。 */
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--am-space-3);
    padding-block: var(--am-space-2);
    border-block-end: 1px solid var(--am-color-border);
  }
  .catalog-drawers__header[data-empty='true'] .catalog-drawers__state-toolbar {
    display: contents;
  }
}
@media (max-width: 768px) {
  .catalog-drawers__header {
    position: sticky;
    z-index: var(--am-z-sticky);
    inset-block-start: 0;
    display: grid;
    grid-template-areas: 'intro actions' 'states states';
    /* 账号按内容收紧；发现入口使用余量，长名称时可退回原有的 80px。 */
    grid-template-columns: minmax(0, max-content) minmax(80px, 1fr);
    align-items: center;
    gap: var(--am-space-2);
    padding-block: var(--am-space-2);
    border-block-end: 1px solid var(--am-color-border);
    background: var(--am-color-surface-subtle);
  }
  .catalog-drawers__intro {
    grid-area: intro;
  }
  .catalog-drawers__description {
    display: none;
  }
  .catalog-drawers__state-toolbar {
    display: contents;
  }
  .catalog-drawers__title-actions {
    grid-area: actions;
    justify-self: end;
    inline-size: 100%;
    max-inline-size: 50cqi;
  }
  .catalog-drawers__discover {
    flex: 1;
    min-inline-size: 80px;
    gap: var(--am-space-1);
    padding-inline: var(--am-space-2);
  }
  .catalog-drawers__states {
    grid-area: states;
  }
}
@media (prefers-reduced-motion: reduce) {
  .catalog-drawers__states button,
  .catalog-drawers__discover,
  .catalog-drawers__discover .app-icon {
    transition: none;
  }
}
</style>
