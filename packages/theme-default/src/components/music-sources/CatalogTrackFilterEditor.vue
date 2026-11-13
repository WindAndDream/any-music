<script setup lang="ts">
import type { CatalogFilterHistoryEntry } from '@any-music/ui/catalog'
import { useCatalogTrackFilterEditor } from '@any-music/ui/catalog'
import type {
  CatalogTagStat,
  CatalogPlatformStat,
  CatalogNamingFilter,
  CatalogTrackFilterState,
} from '@any-music/ui/catalog'
import {
  filterCatalogTagStats,
  getCatalogTrackFilterLabels,
  type CatalogFilterContext,
  type CatalogTrackFilterDimension,
} from '@any-music/ui/catalog'
import { computed, nextTick, onMounted, shallowRef, useId, useTemplateRef, watch } from 'vue'

import CatalogFilterCalendar from './CatalogFilterCalendar.vue'
import CatalogFilterDateControls from './CatalogFilterDateControls.vue'
import CatalogFilterDateRange from './CatalogFilterDateRange.vue'
import CatalogFilterHistoryList from './CatalogFilterHistoryList.vue'
import CatalogFilterRangeList from './CatalogFilterRangeList.vue'
import CatalogNamingFilterControls from './CatalogNamingFilterControls.vue'

/** 表现层组合筛选控件；状态、区间更新和历史恢复由 headless 编辑器负责。 */
const props = withDefaults(
  defineProps<{
    dimension: CatalogTrackFilterDimension
    tagStats: readonly CatalogTagStat[]
    platformStats?: readonly CatalogPlatformStat[]
    historyEntries: readonly CatalogFilterHistoryEntry[]
    historyCollapseAfter?: number
    initialIndex?: number
    filterContext?: CatalogFilterContext
    historyRecords?: boolean
  }>(),
  { filterContext: 'tracks', platformStats: () => [] },
)
const emit = defineEmits<{
  confirm: []
  removeHistory: [entry: CatalogFilterHistoryEntry]
  previewChange: [filters: CatalogTrackFilterState]
}>()
const filters = defineModel<CatalogTrackFilterState>('filters', { required: true })
const root = useTemplateRef<HTMLElement>('root')
const searchInput = useTemplateRef<HTMLInputElement>('searchInput')
const editorId = useId()
const tagQuery = shallowRef('')
const visibleTagStats = computed(() => filterCatalogTagStats(props.tagStats, tagQuery.value))
const platformNames = computed(() => new Map(props.platformStats.map(({ id, name }) => [id, name])))
const selectedLabels = computed(() =>
  getCatalogTrackFilterLabels(filters.value, props.dimension, platformNames.value),
)
const naming = computed({
  get: () => filters.value.naming ?? 'all',
  set: (nextNaming: CatalogNamingFilter) => {
    filters.value = { ...filters.value, naming: nextNaming }
  },
})
const {
  previewFilters,
  searchQuery,
  pendingStart,
  pendingEnd,
  publishedStage,
  calendarMonth,
  minimumMinutes,
  maximumMinutes,
  editingIndex,
  errorMessage,
  durationError,
  canAddPublishedRange,
  canAddDurationRange,
  selectPublishedDate,
  setPublishedStage,
  editRange,
  addPublishedRange,
  addDurationRange,
  removeRange,
  restoreHistory,
  confirmDraft,
} = useCatalogTrackFilterEditor({
  filters,
  dimension: () => props.dimension,
  initialIndex: props.initialIndex,
})

// 只上抛预览快照；待输入区间保持在编辑器内，直到添加或确定才提交。
watch(previewFilters, (preview) => emit('previewChange', preview), { immediate: true })

function toggleTag(tag: string): void {
  const tags = new Set(filters.value.tags)
  if (tags.has(tag)) tags.delete(tag)
  else tags.add(tag)
  filters.value = { ...filters.value, tags: [...tags] }
}

function togglePlatform(id: string): void {
  const platformIds = new Set(filters.value.platformIds)
  if (platformIds.has(id)) platformIds.delete(id)
  else platformIds.add(id)
  filters.value = { ...filters.value, platformIds: [...platformIds] }
}

/** 入场动画结束再次聚焦，避免面板把搜索输入焦点移回底部按钮。 */
function focusInitialControl(): void {
  if (props.dimension === 'search') searchInput.value?.focus({ preventScroll: true })
  else if (props.dimension === 'tags' && props.initialIndex !== undefined)
    root.value
      ?.querySelector<HTMLInputElement>(`[data-selected-tag-index="${props.initialIndex}"]`)
      ?.focus({ preventScroll: true })
  else
    root.value
      ?.querySelector<HTMLElement>('[data-editor-focus], [data-calendar-date][tabindex="0"]')
      ?.focus({ preventScroll: true })
}

async function handleRestore(entry: CatalogFilterHistoryEntry): Promise<void> {
  restoreHistory(entry)
  await nextTick()
  focusInitialControl()
}

/** 加入后会隐藏提交按钮，将键盘焦点交回起始入口，方便继续设置下一段。 */
async function handleAddPublishedRange(): Promise<void> {
  if (!addPublishedRange()) return
  await nextTick()
  root.value
    ?.querySelector<HTMLButtonElement>('[aria-label="设置起始日期"]')
    ?.focus({ preventScroll: true })
}

/** 删除后的焦点留在相邻区间；清空列表时回到当前输入，避免落到面板外。 */
async function handleRemoveRange(index: number): Promise<void> {
  removeRange(index)
  await nextTick()
  const nextIndex = Math.min(index, selectedLabels.value.length - 1)
  const adjacent = root.value?.querySelector<HTMLButtonElement>(`[data-range-edit="${nextIndex}"]`)
  if (adjacent) adjacent.focus({ preventScroll: true })
  else focusInitialControl()
}

onMounted(focusInitialControl)
defineExpose({ focusInitialControl, confirmDraft })
</script>

<template>
  <div
    ref="root"
    class="catalog-filter-editor"
    :class="{
      'catalog-filter-editor--search': props.dimension === 'search',
      'catalog-filter-editor--published': props.dimension === 'published',
    }"
  >
    <template v-if="props.dimension === 'search'">
      <form class="catalog-filter-editor__search" role="search" @submit.prevent="emit('confirm')">
        <label :for="`${editorId}-search`" class="catalog-filter-editor__label">{{
          props.filterContext === 'drawers' ? '列表名称、搜索词、链接或来源' : '名称、作者或用户 ID'
        }}</label>
        <span class="catalog-filter-editor__input-control"
          ><input
            :id="`${editorId}-search`"
            ref="searchInput"
            v-model="searchQuery"
            class="catalog-filter-editor__line-input catalog-filter-editor__search-input"
            type="search"
            autocomplete="off"
            inputmode="search"
            maxlength="120"
            :placeholder="
              props.filterContext === 'drawers'
                ? '输入列表名称、搜索词、链接或来源'
                : '输入名称、作者或用户 ID'
            "
        /></span>
      </form>
      <CatalogFilterHistoryList
        :entries="props.historyEntries"
        :collapse-after="props.historyCollapseAfter"
        title="搜索历史"
        @restore="handleRestore"
        @remove="emit('removeHistory', $event)"
        @focus-empty="focusInitialControl"
      />
    </template>

    <template v-else-if="props.dimension === 'tags'">
      <p v-if="props.tagStats.length === 0" class="catalog-filter-editor__empty">
        已加载歌曲还没有用户标签。
      </p>
      <template v-else>
        <label class="catalog-filter-editor__field"
          ><span>搜索标签</span
          ><span class="catalog-filter-editor__input-control"
            ><input
              v-model="tagQuery"
              class="catalog-filter-editor__line-input"
              type="search"
              autocomplete="off"
              placeholder="输入标签名称"
              data-editor-focus /></span
        ></label>
        <p v-if="visibleTagStats.length === 0" class="catalog-filter-editor__empty">
          未找到匹配标签。
        </p>
        <div v-else class="catalog-filter-editor__tags">
          <label v-for="tag in visibleTagStats" :key="tag.name" class="catalog-filter-tag">
            <input
              type="checkbox"
              :checked="filters.tags.includes(tag.name)"
              :data-selected-tag-index="filters.tags.indexOf(tag.name)"
              @change="toggleTag(tag.name)"
            />
            <span>{{ tag.name }}</span
            ><small>{{ tag.count }} {{ props.historyRecords ? '条' : '首' }}</small>
          </label>
        </div>
      </template>
      <CatalogFilterHistoryList
        :entries="props.historyEntries"
        :collapse-after="props.historyCollapseAfter"
        title="标签筛选历史"
        @restore="handleRestore"
        @remove="emit('removeHistory', $event)"
        @focus-empty="focusInitialControl"
      />
    </template>

    <template v-else-if="props.dimension === 'naming'">
      <CatalogNamingFilterControls v-model="naming" :filter-context="props.filterContext" />
      <CatalogFilterHistoryList
        :entries="props.historyEntries"
        :collapse-after="props.historyCollapseAfter"
        title="命名筛选历史"
        @restore="handleRestore"
        @remove="emit('removeHistory', $event)"
        @focus-empty="focusInitialControl"
      />
    </template>

    <template v-else-if="props.dimension === 'platforms'">
      <p class="catalog-filter-editor__empty">
        未选择时显示全部平台；选择多个平台时匹配其中任意一个。
      </p>
      <div class="catalog-filter-editor__tags">
        <label
          v-for="platform in props.platformStats"
          :key="platform.id"
          class="catalog-filter-tag"
        >
          <input
            type="checkbox"
            :checked="filters.platformIds?.includes(platform.id) ?? false"
            data-editor-focus
            @change="togglePlatform(platform.id)"
          />
          <span>{{ platform.name }}</span
          ><small
            >{{ platform.count }} {{ props.filterContext === 'drawers' ? '个列表' : '首' }}</small
          >
        </label>
      </div>
      <CatalogFilterHistoryList
        :entries="props.historyEntries"
        :collapse-after="props.historyCollapseAfter"
        title="平台筛选历史"
        :platform-names="platformNames"
        @restore="handleRestore"
        @remove="emit('removeHistory', $event)"
        @focus-empty="focusInitialControl"
      />
    </template>

    <div v-else-if="props.dimension === 'published'" class="catalog-filter-editor__split">
      <CatalogFilterDateControls
        class="catalog-filter-editor__date-controls"
        :stage="publishedStage"
        :has-end-date="Boolean(pendingEnd)"
        :can-add-range="canAddPublishedRange"
        :is-editing="editingIndex !== undefined"
        @select-stage="setPublishedStage"
        @add-range="handleAddPublishedRange"
      />
      <CatalogFilterCalendar
        v-model:month="calendarMonth"
        :from="pendingStart"
        :to="pendingEnd"
        :stage="publishedStage"
        @select-date="selectPublishedDate"
      />
      <aside
        class="catalog-filter-editor__aside"
        :aria-label="
          props.historyRecords
            ? '播放时间范围与历史'
            : props.filterContext === 'drawers'
              ? '搜索时间范围与历史'
              : props.filterContext === 'downloads'
                ? '任务日期范围与历史'
                : props.filterContext === 'queue'
                  ? '添加时间范围与历史'
                  : props.filterContext === 'favorites'
                    ? '喜欢时间范围与历史'
                    : '发布时间范围与历史'
        "
      >
        <div class="catalog-filter-editor__pending" aria-live="polite">
          <span class="catalog-filter-editor__label">{{
            editingIndex === undefined ? '当前时间范围' : '正在修改时间范围'
          }}</span>
          <CatalogFilterDateRange
            :from="pendingStart"
            :to="pendingEnd"
            :active-stage="publishedStage"
            prominent
            interactive
            @select-stage="setPublishedStage"
          />
        </div>
        <p v-if="errorMessage" class="catalog-filter-editor__error" role="alert">
          {{ errorMessage }}
        </p>
        <CatalogFilterRangeList
          title="已选时间范围"
          :labels="selectedLabels"
          :editing-index="editingIndex"
          @edit="editRange"
          @remove="handleRemoveRange"
        />
        <CatalogFilterHistoryList
          :entries="props.historyEntries"
          :collapse-after="props.historyCollapseAfter"
          title="历史筛选时间"
          @restore="handleRestore"
          @remove="emit('removeHistory', $event)"
          @focus-empty="focusInitialControl"
        />
      </aside>
    </div>

    <div v-else class="catalog-filter-editor__split">
      <form class="catalog-filter-editor__duration" @submit.prevent="addDurationRange">
        <label class="catalog-filter-editor__field"
          ><span>最短（分钟）</span
          ><span class="catalog-filter-editor__input-control"
            ><input
              v-model="minimumMinutes"
              class="catalog-filter-editor__line-input"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              placeholder="不限"
              aria-label="最短时长（分钟）"
              :aria-invalid="Boolean(durationError)"
              :aria-describedby="durationError ? `${editorId}-duration-error` : undefined"
              data-editor-focus /></span
        ></label>
        <label class="catalog-filter-editor__field"
          ><span>最长（分钟）</span
          ><span class="catalog-filter-editor__input-control"
            ><input
              v-model="maximumMinutes"
              class="catalog-filter-editor__line-input"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              placeholder="不限"
              aria-label="最长时长（分钟）"
              :aria-invalid="Boolean(durationError)"
              :aria-describedby="durationError ? `${editorId}-duration-error` : undefined" /></span
        ></label>
        <p
          v-if="durationError || errorMessage"
          :id="`${editorId}-duration-error`"
          class="catalog-filter-editor__error"
          role="alert"
        >
          {{ durationError || errorMessage }}
        </p>
        <button type="submit" class="catalog-filter-editor__add" :disabled="!canAddDurationRange">
          {{ editingIndex === undefined ? '加入时长段' : '更新时长段' }}
        </button>
      </form>
      <aside class="catalog-filter-editor__aside" aria-label="歌曲时长范围与历史">
        <CatalogFilterRangeList
          title="已选歌曲时长"
          :labels="selectedLabels"
          :editing-index="editingIndex"
          @edit="editRange"
          @remove="handleRemoveRange"
        />
        <CatalogFilterHistoryList
          :entries="props.historyEntries"
          :collapse-after="props.historyCollapseAfter"
          title="历史筛选时长"
          @restore="handleRestore"
          @remove="emit('removeHistory', $event)"
          @focus-empty="focusInitialControl"
        />
      </aside>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/catalog-filter-editor';
@include catalog-filter-editor.editor;
</style>
