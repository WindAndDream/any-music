<script setup lang="ts">
import { getCatalogTrackFilterLabels, type CatalogFilterHistoryEntry } from '@any-music/ui/catalog'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import FilterHistoryChips from '@any-music/ui/components/FilterHistoryChips.vue'
import { computed, nextTick, shallowRef, useId, useTemplateRef } from 'vue'

import StudioPageOverlays from '../overlays/StudioPageOverlays.vue'

const props = defineProps<{
  entries: readonly CatalogFilterHistoryEntry[]
  platformNames: ReadonlyMap<string, string>
}>()
const emit = defineEmits<{
  restore: [entry: CatalogFilterHistoryEntry]
  remove: [entry: CatalogFilterHistoryEntry]
}>()

const historyId = useId()
const historyList = useTemplateRef<HTMLElement>('historyList')
const items = computed(() =>
  props.entries.map((entry) => ({
    entry,
    key: JSON.stringify(entry),
    labels: getCatalogTrackFilterLabels(entry.filters, entry.dimension, props.platformNames),
  })),
)
type HistoryItem = (typeof items.value)[number]
const preview = shallowRef<{ item: HistoryItem; triggerId: string }>()
const previewPhase = shallowRef<'closed' | 'open' | 'leaving'>('closed')

function activate(item: HistoryItem, triggerId: string): void {
  if (item.entry.dimension !== 'platforms') {
    emit('restore', item.entry)
    return
  }
  preview.value = { item, triggerId }
  previewPhase.value = 'open'
}

function restorePreview(): void {
  if (previewPhase.value !== 'open' || !preview.value) return
  emit('restore', preview.value.item.entry)
  previewPhase.value = 'leaving'
}

async function remove(entry: CatalogFilterHistoryEntry, index: number): Promise<void> {
  emit('remove', entry)
  await nextTick()
  const nextIndex = Math.min(index, items.value.length - 1)
  historyList.value
    ?.querySelector<HTMLElement>(
      nextIndex >= 0 ? `[data-history-remove="${nextIndex}"]` : 'summary',
    )
    ?.focus({ preventScroll: true })
}
</script>

<template>
  <details ref="historyList">
    <summary>筛选历史</summary>
    <p v-if="!items.length">暂无历史条件。</p>
    <div v-for="(item, index) in items" :key="item.key" class="studio-filter-history__row">
      <button
        :id="`${historyId}-entry-${index}`"
        type="button"
        class="studio-filter-history__restore"
        :class="{ 'studio-filter-history__restore--tags': item.entry.dimension === 'tags' }"
        :aria-haspopup="item.entry.dimension === 'platforms' ? 'dialog' : undefined"
        :aria-label="`${item.entry.dimension === 'platforms' ? '查看平台筛选历史' : '恢复筛选'} ${item.labels.join('；')}`"
        @click="activate(item, `${historyId}-entry-${index}`)"
      >
        <FilterHistoryChips
          v-if="item.entry.dimension === 'tags' || item.entry.dimension === 'platforms'"
          :labels="item.labels"
          :single-line="item.entry.dimension === 'platforms'"
        />
        <template v-else>{{ item.labels.join(' / ') }}</template>
      </button>
      <button
        type="button"
        class="studio-filter-history__remove"
        :data-history-remove="index"
        :aria-label="`删除历史筛选 ${item.labels.join('；')}`"
        title="删除这组历史"
        @click="remove(item.entry, index)"
      >
        <AppIcon name="trash" :size="16" />
      </button>
    </div>
  </details>
  <StudioPageOverlays :open="previewPhase !== 'closed'">
    <AppDialog
      :open="previewPhase === 'open'"
      title="平台筛选历史"
      size="compact"
      :return-focus-selector="preview && `[id='${preview.triggerId}']`"
      @close="previewPhase = 'leaving'"
      @after-leave="previewPhase = 'closed'"
    >
      <FilterHistoryChips v-if="preview" :labels="preview.item.labels" />
      <template #footer>
        <button type="button" @click="restorePreview">恢复筛选</button>
      </template>
    </AppDialog>
  </StudioPageOverlays>
</template>

<style scoped>
.studio-filter-history__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  gap: var(--am-space-1);
  margin-block: var(--am-space-1);
}
.studio-filter-history__restore {
  display: grid;
  justify-content: stretch;
  min-inline-size: 0;
  font-weight: 650;
  overflow-wrap: anywhere;
  text-align: start;
}
.studio-filter-history__restore--tags:hover {
  background: var(--am-color-surface);
}
.studio-filter-history__remove {
  color: var(--am-color-text-secondary);
}
.studio-filter-history__remove:hover,
.studio-filter-history__remove:focus-visible,
.studio-filter-history__remove:active {
  border-color: var(--am-color-danger-container);
  background: var(--am-color-danger-container);
  color: var(--am-color-danger);
}
</style>
