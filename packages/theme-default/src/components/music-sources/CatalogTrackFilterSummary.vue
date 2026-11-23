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

/** 将受控的筛选草稿转换为可编辑的概览分组。 */
const props = withDefaults(
  defineProps<{
    filters: CatalogTrackFilterState
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
    @edit="(dimension, index) => emit('edit', dimension, index)"
    @remove="(dimension, index) => emit('remove', dimension, index)"
  />
</template>
