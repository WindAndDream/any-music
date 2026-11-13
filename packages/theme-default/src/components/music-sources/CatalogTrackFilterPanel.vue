<script setup lang="ts">
import { createFilterPanelState, filterPanelKey } from '@any-music/ui/catalog'
import { useCatalogFilterHistory } from '@any-music/ui/catalog'
import {
  cloneCatalogTrackFilterState,
  createCatalogTrackFilterState,
  countCatalogTrackFilters,
  type CatalogTagStat,
  type CatalogTrackFilterState,
} from '@any-music/ui/catalog'
import { useBackHandler } from '@any-music/ui/catalog'
import { useConfirmAction } from '@any-music/ui/catalog'
import { useEditingSession, provideEditingSession } from '@any-music/ui/catalog'
import { useUiContributionAvailability } from '@any-music/ui/catalog'
import {
  getCatalogFilterDimensions,
  commitCatalogTrackFilterDimension,
  getCatalogTrackFilterDimensionCount,
  getCatalogTrackFilterLabels,
  type CatalogFilterContext,
  type CatalogTrackFilterDimension,
} from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

import CatalogFilterPreview from './CatalogFilterPreview.vue'
import CatalogTrackFilterEditor from './CatalogTrackFilterEditor.vue'
import CatalogTrackFilterSummary from './CatalogTrackFilterSummary.vue'

/** 歌曲和外层音乐列表共用草稿、预览、日历与历史交互，维度目录由上下文收窄。 */
const props = withDefaults(
  defineProps<{
    tagStats: readonly CatalogTagStat[]
    platformStats?: readonly { id: string; name: string; count: number }[]
    resultCount: number
    totalCount: number
    /** 稳定归属标识必须由业务容器提供；相同维度在不同筛选器中不共享历史。 */
    historyScope: string
    filterContext?: CatalogFilterContext
    historyRecords?: boolean
    platformScoped?: boolean
  }>(),
  { filterContext: 'tracks', platformStats: () => [] },
)
defineSlots<{ extensions?: () => unknown }>()

const emit = defineEmits<{
  detailOpenChange: [isOpen: boolean]
  /** 预览可以包含未提交的维度输入，调用方只能用它派生数量，不能覆盖面板草稿。 */
  previewChange: [filters: CatalogTrackFilterState]
}>()

const filters = defineModel<CatalogTrackFilterState>('filters', {
  required: true,
})

const confirmAction = useConfirmAction()
const contributions = useUiContributionAvailability('trackList.filters')
const overview = useTemplateRef<HTMLElement>('overview')
const dimensionsRail = useTemplateRef<HTMLElement>('dimensionsRail')
let dimensionsScrollLeft = 0
watch(
  dimensionsRail,
  (rail) => {
    if (rail) rail.scrollLeft = dimensionsScrollLeft
  },
  { flush: 'post' },
)
const editor = useTemplateRef<InstanceType<typeof CatalogTrackFilterEditor>>('editor')
const history = useCatalogFilterHistory().forScope(() => props.historyScope)
const editing = useEditingSession('filter-panel')
provideEditingSession(editing)
const { initialIndex, activeDimension, dimensionDraft, dimensionPreview } = editing.state(
  filterPanelKey,
  createFilterPanelState,
)
const previousDimension = shallowRef<CatalogTrackFilterDimension>()
watch(
  () => props.platformScoped,
  (scoped) => {
    if (scoped && activeDimension.value === 'platforms') {
      activeDimension.value = undefined
      dimensionPreview.value = undefined
    }
  },
  { immediate: true },
)

const filterCounts = computed(() => countCatalogTrackFilters(filters.value))
const dimensions = computed(() =>
  getCatalogFilterDimensions(props.filterContext, { platformScoped: props.platformScoped })
    .filter((dimension) => dimension.id !== 'tags' || contributions.allows('tag-filter'))
    .map((dimension) => ({
      id: dimension.id,
      label: props.historyRecords && dimension.id === 'published' ? '播放时间' : dimension.label,
      description:
        props.historyRecords && dimension.id === 'published'
          ? '按播放日期筛选，支持多个日期区间'
          : dimension.description,
      icon: dimension.icon,
      count: getCatalogTrackFilterDimensionCount(filters.value, dimension.id),
    })),
)
const activeDimensionView = computed(() => {
  const dimension =
    getCatalogFilterDimensions(props.filterContext, { platformScoped: props.platformScoped }).find(
      (item) => item.id === activeDimension.value,
    ) ?? getCatalogFilterDimensions(props.filterContext)[0]!
  return props.historyRecords && dimension.id === 'published'
    ? { ...dimension, label: '播放时间', description: '按播放日期筛选，支持多个日期区间' }
    : dimension
})
const activeDraftCount = computed(() =>
  activeDimension.value
    ? getCatalogTrackFilterDimensionCount(dimensionDraft.value, activeDimension.value)
    : 0,
)
const historyEntries = computed(() =>
  history.entries.value.filter((entry) => entry.dimension === activeDimension.value),
)

const previewFilters = computed(() =>
  activeDimension.value
    ? commitCatalogTrackFilterDimension(
        filters.value,
        dimensionPreview.value ?? dimensionDraft.value,
        activeDimension.value,
      )
    : filters.value,
)
// 返回概览自动恢复原草稿的数量；预览始终保留其他维度，与最终应用使用同一规则。
watch(previewFilters, (preview) => emit('previewChange', preview), { immediate: true })
// The editing session can outlive this panel when a sheet closes or a theme changes.
emit('detailOpenChange', Boolean(activeDimension.value))

// Change the outer footer only after the old view has left, so it cannot resize that view.
function handleViewAfterLeave(): void {
  emit('detailOpenChange', Boolean(activeDimension.value))
}

/** 维度编辑使用隔离副本；返回不会污染概览，确定才合并当前维度。 */
function openDimension(dimension: CatalogTrackFilterDimension, index?: number): void {
  dimensionsScrollLeft = dimensionsRail.value?.scrollLeft ?? dimensionsScrollLeft
  editing.clearScope('range-editor')
  dimensionDraft.value = cloneCatalogTrackFilterState(filters.value)
  dimensionPreview.value = undefined
  initialIndex.value = index
  activeDimension.value = dimension
}

function returnToOverview(): void {
  previousDimension.value = activeDimension.value
  activeDimension.value = undefined
}
useBackHandler({
  active: () => activeDimension.value !== undefined,
  handle: returnToOverview,
})

async function confirmDimension(): Promise<void> {
  if (
    !activeDimension.value ||
    (activeDimension.value === 'tags' && !contributions.allows('tag-filter'))
  )
    return
  if (editor.value && !editor.value.confirmDraft()) return
  const confirmedFilters = commitCatalogTrackFilterDimension(
    filters.value,
    dimensionDraft.value,
    activeDimension.value,
  )
  // defineModel 的 emit 同步发出，但父级 props 下帧才回流；历史必须读取这次提交的快照。
  if (activeDimension.value === 'tags') delete confirmedFilters.tagsDormant
  filters.value = confirmedFilters
  history.remember(activeDimension.value, confirmedFilters)
  await returnToOverview()
}

/** 单项删除立即更新面板草稿；外层取消仍可撤回，只有清空全部需要确认。 */
async function removeFilter(dimension: CatalogTrackFilterDimension, index: number): Promise<void> {
  if (getCatalogTrackFilterLabels(filters.value, dimension)[index] === undefined) return

  if (dimension === 'search') {
    filters.value = {
      ...filters.value,
      searchFilters: filters.value.searchFilters.filter((_, entryIndex) => entryIndex !== index),
    }
  } else if (dimension === 'tags') {
    filters.value = {
      ...filters.value,
      tags: filters.value.tags.filter((_, entryIndex) => entryIndex !== index),
    }
  } else if (dimension === 'published') {
    filters.value = {
      ...filters.value,
      publishedRanges: filters.value.publishedRanges.filter(
        (_, entryIndex) => entryIndex !== index,
      ),
    }
  } else if (dimension === 'platforms') {
    filters.value = {
      ...filters.value,
      platformIds: filters.value.platformIds?.filter((_, entryIndex) => entryIndex !== index) ?? [],
    }
  } else if (dimension === 'naming') {
    filters.value = { ...filters.value, naming: 'all' }
  } else {
    filters.value = {
      ...filters.value,
      durationRanges: filters.value.durationRanges.filter((_, entryIndex) => entryIndex !== index),
    }
  }

  await nextTick()
  overview.value
    ?.querySelector<HTMLButtonElement>(`[data-filter-dimension="${dimension}"]`)
    ?.focus({ preventScroll: true })
}

/** 清空当前草稿；外层“取消”仍可放弃这次面板编辑。 */
async function clearAllFilters(): Promise<void> {
  const counts = filterCounts.value
  if (counts.total === 0) return
  const shouldClear = await confirmAction({
    title: '清空全部筛选？',
    message: [
      `将移除当前草稿中的 ${counts.total} 条条件。`,
      dimensions.value.map(({ label, count }) => `${label} ${count} 条`).join(' · ') + '。',
      `此操作只修改当前草稿，应用筛选后才会影响${props.filterContext === 'drawers' ? '音乐' : '歌曲'}列表。`,
    ].join('\n'),
    confirmLabel: '清空全部',
    tone: 'danger',
  })
  if (!shouldClear) return

  filters.value = createCatalogTrackFilterState()
  await nextTick()
  overview.value
    ?.querySelector<HTMLButtonElement>('[data-filter-dimension="search"]')
    ?.focus({ preventScroll: true })
}

/** 等滑动视图进入后聚焦输入/日历；返回时恢复被点击的具体条件或维度入口。 */
function handleViewAfterEnter(): void {
  if (activeDimension.value) {
    editor.value?.focusInitialControl()
    return
  }

  const criterion =
    initialIndex.value === undefined
      ? undefined
      : overview.value?.querySelector<HTMLButtonElement>(
          `[data-filter-edit="${previousDimension.value}:${initialIndex.value}"]`,
        )
  if (criterion) {
    criterion.focus({ preventScroll: true })
    return
  }
  overview.value
    ?.querySelector<HTMLButtonElement>(`[data-filter-dimension="${previousDimension.value}"]`)
    ?.focus({ preventScroll: true })
}

/** 离场时立即释放旧编辑页的点击与键盘入口。 */
function disableLeavingView(element: Element): void {
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}
</script>

<template>
  <p
    v-if="(!contributions.allows('tag-filter') || filters.tagsDormant) && filters.tags.length"
    role="status"
  >
    休眠标签条件：{{
      filters.tags.join(' · ')
    }}。标签功能停用或不可用，当前不参与筛选；重新启用后可恢复。<button
      v-if="contributions.allows('tag-filter')"
      type="button"
      @click="filters = { ...filters, tagsDormant: false }"
    >
      恢复标签条件
    </button>
  </p>
  <section
    class="catalog-filters"
    :aria-label="
      props.historyRecords
        ? '播放历史筛选器'
        : props.filterContext === 'drawers'
          ? '音乐列表筛选器'
          : props.filterContext === 'downloads'
            ? '下载筛选器'
            : props.filterContext === 'queue'
              ? '待听筛选器'
              : props.filterContext === 'favorites'
                ? '我的喜欢筛选器'
                : '曲目筛选器'
    "
  >
    <Transition
      name="catalog-filter-fade"
      mode="out-in"
      @before-leave="disableLeavingView"
      @after-leave="handleViewAfterLeave"
      @after-enter="handleViewAfterEnter"
    >
      <div v-if="!activeDimension" ref="overview" key="overview" class="catalog-filters__overview">
        <nav ref="dimensionsRail" class="catalog-filters__dimensions" aria-label="筛选类型">
          <slot name="extensions" />
          <button
            v-for="dimension in dimensions"
            :key="dimension.id"
            class="catalog-filter-dimension"
            type="button"
            :data-filter-dimension="dimension.id"
            @click="openDimension(dimension.id)"
          >
            <span class="catalog-filter-dimension__icon">
              <AppIcon :name="dimension.icon" :size="17" />
            </span>
            <span class="catalog-filter-dimension__copy">
              <strong>{{ dimension.label }}</strong>
              <small v-if="dimension.count > 0">已筛选 {{ dimension.count }} 项</small>
            </span>
            <span v-if="dimension.count > 0" class="catalog-filter-dimension__count">
              {{ dimension.count }}
            </span>
            <AppIcon class="catalog-filter-dimension__arrow" name="arrow-right" :size="15" />
          </button>
        </nav>

        <div class="catalog-filters__summary">
          <CatalogTrackFilterSummary
            :filters="filters"
            :result-count="resultCount"
            :total-count="totalCount"
            :filter-context="props.filterContext"
            :history-records="props.historyRecords"
            :platform-scoped="props.platformScoped"
            :platform-stats="props.platformStats"
            @edit="openDimension"
            @remove="removeFilter"
            @clear="clearAllFilters"
          />
        </div>
      </div>

      <section
        v-else
        key="detail"
        class="catalog-filters__detail"
        :class="{ 'catalog-filters__detail--published': activeDimension === 'published' }"
      >
        <header class="catalog-filters__detail-header">
          <div class="catalog-filters__detail-heading">
            <div>
              <strong>{{ activeDimensionView.label }}</strong>
              <small>{{ activeDimensionView.description }}</small>
            </div>
          </div>
          <CatalogFilterPreview
            :result-count="resultCount"
            :total-count="totalCount"
            :unit="
              props.historyRecords ? '条' : props.filterContext === 'drawers' ? '个列表' : '首'
            "
          />
        </header>

        <div class="catalog-filters__detail-content">
          <CatalogTrackFilterEditor
            ref="editor"
            :key="activeDimensionView.id"
            v-model:filters="dimensionDraft"
            :dimension="activeDimensionView.id"
            :filter-context="props.filterContext"
            :history-records="props.historyRecords"
            :tag-stats="tagStats"
            :platform-stats="props.platformStats"
            :history-entries="historyEntries"
            :history-collapse-after="history.settings.value.collapseAfter"
            :initial-index="initialIndex"
            @confirm="confirmDimension"
            @remove-history="history.remove"
            @preview-change="dimensionPreview = $event"
          />
        </div>

        <footer class="catalog-filters__detail-footer">
          <span>{{
            activeDraftCount > 0 ? `本项已设置 ${activeDraftCount} 条` : '本项未筛选'
          }}</span>
          <div class="catalog-filters__detail-actions">
            <button
              ref="footerBackButton"
              class="catalog-filters__footer-back"
              type="button"
              aria-label="返回筛选概览"
              @click="returnToOverview"
            >
              <AppIcon name="arrow-left" :size="16" />
              返回
            </button>
            <button class="catalog-filters__footer-confirm" type="button" @click="confirmDimension">
              <AppIcon name="check" :size="16" />
              确定
            </button>
          </div>
        </footer>
      </section>
    </Transition>
  </section>
</template>

<style scoped lang="scss">
@use '../../styles/collection-filters';
@include collection-filters.panel;
</style>
