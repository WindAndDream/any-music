<script setup lang="ts">
import {
  cloneCatalogTrackFilterState,
  useCatalogTrackFilterEditor,
  provideEditingSession,
  useEditingSession,
  useCatalogFilterHistory,
  getCatalogTrackFilterLabels,
  commitCatalogTrackFilterDimension,
  createFilterPanelState,
  filterPanelKey,
  getCatalogFilterDimensions,
  useUiContributionAvailability,
  getCatalogTagStats,
} from '@any-music/ui/catalog'
import type { CatalogTrackFilterDimension, CatalogFilterContext } from '@any-music/ui/catalog'
import type { EditingSession } from '@any-music/ui/catalog'
import type { UiThemeTrackListActions, UiThemeTrackListState } from '@any-music/ui/theme'
import { computed, watch } from 'vue'
import type { DeepReadonly } from 'vue'

const props = defineProps<{
  state: DeepReadonly<
    Pick<
      UiThemeTrackListState,
      'tracks' | 'filterDraft' | 'filters' | 'platformNames' | 'customTagsByTrackId'
    >
  >
  actions: Pick<UiThemeTrackListActions, 'setFilterDraft' | 'applyFilters' | 'cancelFilters'>
  scope: string
  open?: boolean
  editing?: EditingSession
  context?: CatalogFilterContext
  historyRecords?: boolean
  platformScoped?: boolean
}>()
const emit = defineEmits<{ finished: [] }>()
const editing = props.editing ?? useEditingSession(props.scope)
const panelSession = editing.scope('filter-panel')
provideEditingSession(editing)
const panel = panelSession.state(filterPanelKey, createFilterPanelState)
watch(
  () => props.platformScoped,
  (scoped) => {
    if (scoped && panel.activeDimension.value === 'platforms')
      panel.activeDimension.value = undefined
  },
  { immediate: true },
)
const dimension = computed<CatalogTrackFilterDimension>({
  get: () => panel.activeDimension.value ?? 'duration',
  set: (value) => {
    if (panel.activeDimension.value !== value) {
      const snapshot = draft.value
      panel.dimensionDraft.value = snapshot
      panel.activeDimension.value = value
    }
  },
})
const draft = computed({
  get: () =>
    panel.activeDimension.value
      ? commitCatalogTrackFilterDimension(
          props.state.filterDraft ?? props.state.filters,
          panel.dimensionDraft.value,
          panel.activeDimension.value,
        )
      : cloneCatalogTrackFilterState(props.state.filterDraft ?? props.state.filters),
  set: (value) => {
    panel.dimensionDraft.value = cloneCatalogTrackFilterState(value)
    props.actions.setFilterDraft(value)
  },
})
const editor = useCatalogTrackFilterEditor({ filters: draft, dimension, editing: panelSession })
const { minimumMinutes, maximumMinutes, pendingStart, pendingEnd, errorMessage, durationError } =
  editor
const history = useCatalogFilterHistory().forScope(() => props.scope)
const context = computed<CatalogFilterContext>(
  () =>
    props.context ??
    (props.scope.startsWith('queue:')
      ? 'queue'
      : props.scope.startsWith('favorites:')
        ? 'favorites'
        : props.scope.startsWith('downloads:')
          ? 'downloads'
          : 'tracks'),
)
const dimensions = computed(() =>
  getCatalogFilterDimensions(context.value, { platformScoped: props.platformScoped }).map(
    (item) => item.id,
  ),
)
const supports = (value: CatalogTrackFilterDimension) => dimensions.value.includes(value)
const queryLabel = computed(() =>
  props.historyRecords ? '播放记录筛选' : context.value === 'drawers' ? '列表筛选' : '歌曲筛选',
)
const contributions = useUiContributionAvailability('trackList.filters')
const tags = computed(() => getCatalogTagStats(props.state.tracks, props.state.customTagsByTrackId))
function toggle(key: 'tags' | 'platformIds', id: string) {
  const values = new Set(draft.value[key] ?? [])
  if (values.has(id)) values.delete(id)
  else values.add(id)
  draft.value = { ...draft.value, [key]: [...values] }
}
function setDate(stage: 'start' | 'end', value: string) {
  dimension.value = 'published'
  editor.setPublishedStage(stage)
  editor.selectPublishedDate(value)
}
function apply() {
  if (!editor.confirmDraft()) return
  for (const key of dimensions.value) history.remember(key, draft.value)
  props.actions.applyFilters()
  panel.activeDimension.value = undefined
  editor.resetPendingRange()
  emit('finished')
}
function addDate() {
  dimension.value = 'published'
  editor.addPublishedRange()
}
function addDuration() {
  dimension.value = 'duration'
  editor.addDurationRange()
}
function removeRange(kind: 'duration' | 'published', index: number) {
  dimension.value = kind
  editor.removeRange(index)
}
function cancel() {
  props.actions.cancelFilters()
  panel.activeDimension.value = undefined
  editor.resetPendingRange()
  emit('finished')
}
</script>
<template>
  <section
    v-if="state.filterDraft || open"
    class="studio-filter"
    :aria-label="historyRecords ? '播放历史筛选草稿' : '歌曲筛选草稿'"
  >
    <h3>{{ historyRecords ? '播放历史筛选草稿' : '歌曲筛选草稿' }}</h3>
    <label class="studio-field"
      >{{ queryLabel
      }}<input
        type="search"
        :aria-label="queryLabel"
        :value="draft.searchFilters[0]?.query ?? ''"
        data-am-focus-key="catalog:filter-query"
        @input="
          draft = {
            ...draft,
            searchFilters: ($event.target as HTMLInputElement).value
              ? [{ query: ($event.target as HTMLInputElement).value }]
              : [],
          }
        "
    /></label>
    <label v-if="supports('naming')"
      >命名状态<select
        :value="draft.naming ?? 'all'"
        @change="
          draft = {
            ...draft,
            naming: ($event.target as HTMLSelectElement).value as 'all' | 'custom' | 'original',
          }
        "
      >
        <option value="all">全部</option>
        <option value="custom">已自定义名称</option>
        <option value="original">来源原名</option>
      </select></label
    >
    <fieldset v-if="supports('platforms')">
      <legend>平台筛选</legend>
      <label v-for="[id, name] in state.platformNames" :key="id"
        ><input
          type="checkbox"
          :checked="draft.platformIds?.includes(id)"
          @change="toggle('platformIds', id)"
        />{{ name }}</label
      >
    </fieldset>
    <fieldset v-if="supports('tags') && (contributions.allows('tag-filter') || draft.tagsDormant)">
      <legend>标签筛选</legend>
      <p v-if="draft.tagsDormant" role="status">标签条件已暂停，恢复功能后需明确重新应用。</p>
      <button
        v-if="draft.tagsDormant && contributions.allows('tag-filter')"
        type="button"
        @click="draft = { ...draft, tagsDormant: false }"
      >
        恢复标签条件
      </button>
      <label v-for="tag in tags" :key="tag.name"
        ><input
          type="checkbox"
          :checked="draft.tags.includes(tag.name)"
          :disabled="draft.tagsDormant"
          @change="toggle('tags', tag.name)"
        />{{ tag.name }} · {{ tag.count }} {{ historyRecords ? '条' : '首' }}</label
      >
    </fieldset>
    <fieldset v-if="supports('published')">
      <legend>{{ historyRecords ? '播放时间' : '日期区间' }}</legend>
      <label
        >起始日期<input
          type="date"
          :value="pendingStart"
          @input="setDate('start', ($event.target as HTMLInputElement).value)" /></label
      ><label
        >结束日期<input
          type="date"
          :value="pendingEnd"
          @input="setDate('end', ($event.target as HTMLInputElement).value)" /></label
      ><button type="button" @click="addDate">添加日期区间</button>
      <p v-for="(range, index) in draft.publishedRanges" :key="index">
        {{ range.from }} — {{ range.to }}
        <button type="button" @click="removeRange('published', index)">移除日期区间</button>
      </p>
    </fieldset>
    <fieldset v-if="supports('duration')">
      <legend>歌曲时长（分钟）</legend>
      <label
        >最短时长<input
          v-model="minimumMinutes"
          inputmode="decimal"
          @input="dimension = 'duration'" /></label
      ><label
        >最长时长<input
          v-model="maximumMinutes"
          inputmode="decimal"
          @input="dimension = 'duration'" /></label
      ><button type="button" @click="addDuration">添加时长区间</button>
      <p v-for="(range, index) in draft.durationRanges" :key="index">
        {{ (range.minMs ?? 0) / 60000 }} —
        {{ range.maxMs === undefined ? '不限' : range.maxMs / 60000 }} 分钟
        <button type="button" @click="removeRange('duration', index)">移除时长区间</button>
      </p>
    </fieldset>
    <p v-if="errorMessage || durationError" role="alert">{{ errorMessage || durationError }}</p>
    <details>
      <summary>筛选历史</summary>
      <p v-if="!history.entries.value.length">暂无历史条件。</p>
      <div v-for="(entry, index) in history.entries.value" :key="index">
        <button
          type="button"
          @click="draft = commitCatalogTrackFilterDimension(draft, entry.filters, entry.dimension)"
        >
          {{ getCatalogTrackFilterLabels(entry.filters, entry.dimension).join(' / ') }}
        </button>
      </div>
    </details>
    <div class="studio-actions">
      <button type="button" @click="cancel">取消筛选</button
      ><button type="button" @click="apply">应用筛选</button>
    </div>
  </section>
</template>
