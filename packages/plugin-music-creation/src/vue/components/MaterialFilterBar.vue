<script setup lang="ts">
import { useUiContributionAvailability } from '@any-music/ui'
import { computed } from 'vue'

import type { MaterialLibraryFilterState } from '../use-material-library-filters'

defineProps<{
  platforms: readonly { id: string; name: string; count: number }[]
  tagStats: readonly { name: string; count: number }[]
}>()

const filters = defineModel<MaterialLibraryFilterState>({ required: true })
const tags = useUiContributionAvailability('trackList.filters')

// Host projections are readonly; replace the model so each edit reaches the owning session.
function filterField<K extends keyof MaterialLibraryFilterState>(key: K) {
  return computed({
    get: () => filters.value[key],
    set: (value: MaterialLibraryFilterState[K]) => {
      filters.value = { ...filters.value, [key]: value }
    },
  })
}

const query = filterField('query')
const membership = filterField('membership')
const trackKind = filterField('trackKind')
const platformId = filterField('platformId')
const tag = filterField('tag')
const sortMode = filterField('sortMode')
</script>

<template>
  <p v-if="(!tags.allows('tag-filter') || filters.tagsDormant) && filters.tag" role="status">
    休眠标签条件：{{ filters.tag }}（当前不参与筛选）<button
      v-if="tags.allows('tag-filter')"
      type="button"
      @click="filters = { ...filters, tagsDormant: false }"
    >
      恢复标签条件
    </button>
  </p>
  <div class="material-filter" aria-label="素材筛选">
    <input v-model="query" placeholder="搜索歌曲、作者或标签" aria-label="搜索歌曲、作者或标签" />
    <select v-model="membership" aria-label="素材合集成员筛选">
      <option value="all">全部资料库音乐</option>
      <option value="included">仅当前合集素材</option>
      <option value="available">仅未加入当前合集</option>
    </select>
    <select v-model="trackKind" aria-label="素材类型筛选">
      <option value="all">普通 + 自定义音乐</option>
      <option value="regular">仅普通音乐</option>
      <option value="custom">仅自定义音乐</option>
    </select>
    <select v-model="platformId" aria-label="素材平台筛选">
      <option value="">全部平台</option>
      <option v-for="platform in platforms" :key="platform.id" :value="platform.id">
        {{ platform.name }} ({{ platform.count }})
      </option>
    </select>
    <select v-if="tags.allows('tag-filter')" v-model="tag" aria-label="素材标签筛选">
      <option value="">全部标签</option>
      <option v-for="tag in tagStats" :key="tag.name" :value="tag.name">
        {{ tag.name }} ({{ tag.count }})
      </option>
    </select>
    <select v-model="sortMode" aria-label="素材排序">
      <option value="updated">最近维护</option>
      <option value="title">歌曲名称</option>
      <option value="duration">时长从长到短</option>
    </select>
  </div>
</template>
