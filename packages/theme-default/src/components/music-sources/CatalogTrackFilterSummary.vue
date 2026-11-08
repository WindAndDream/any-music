<script setup lang="ts">
import type { CatalogTrackFilterState } from '@any-music/ui/catalog'
import { getCatalogFilterDimensions, getCatalogTrackFilterLabels } from '@any-music/ui/catalog'
import type { CatalogFilterContext, CatalogTrackFilterDimension } from '@any-music/ui/catalog'
import { computed } from 'vue'

import CollectionFilterSummary from './CollectionFilterSummary.vue'

interface FilterSummaryGroup {
  dimension: CatalogTrackFilterDimension
  labels: readonly string[]
  title: string
}

/** 概览展示受控草稿与调用方计算的匹配数，只发出编辑、删除和清空请求。 */
const props = withDefaults(
  defineProps<{
    filters: CatalogTrackFilterState
    resultCount: number
    totalCount: number
    filterContext?: CatalogFilterContext
    historyRecords?: boolean
    platformScoped?: boolean
    platformStats?: readonly { id: string; name: string }[]
  }>(),
  { filterContext: 'tracks', platformStats: () => [] },
)

const emit = defineEmits<{
  edit: [dimension: CatalogTrackFilterDimension, index: number]
  remove: [dimension: CatalogTrackFilterDimension, index: number]
  clear: []
}>()

const platformNames = computed(() => new Map(props.platformStats.map(({ id, name }) => [id, name])))
const groups = computed<readonly FilterSummaryGroup[]>(() =>
  getCatalogFilterDimensions(props.filterContext, { platformScoped: props.platformScoped }).map(
    (dimension) => ({
      dimension: dimension.id,
      labels: getCatalogTrackFilterLabels(props.filters, dimension.id, platformNames.value),
      title: props.historyRecords && dimension.id === 'published' ? '播放时间' : dimension.label,
    }),
  ),
)
</script>

<template>
  <CollectionFilterSummary
    :groups="groups"
    :result-count="resultCount"
    :total-count="totalCount"
    :unit="historyRecords ? '条' : filterContext === 'drawers' ? '个列表' : '首'"
    :all-label="
      filterContext === 'drawers' ? '全部音乐列表' : historyRecords ? '全部播放记录' : '全部歌曲'
    "
    :all-description="
      filterContext === 'drawers'
        ? '全部已有音乐列表都会显示'
        : historyRecords
          ? '全部播放记录都会显示'
          : '全部已加载歌曲都会显示'
    "
    @edit="(dimension, index) => emit('edit', dimension, index)"
    @remove="(dimension, index) => emit('remove', dimension, index)"
    @clear="emit('clear')"
  />
</template>
