<script setup lang="ts">
import type { FavoriteFilterState } from '@any-music/ui/library'
import { useUiContributionAvailability } from '@any-music/ui/library'
import { computed } from 'vue'

const props = defineProps<{
  hasRegularSelection: boolean
  hasCustomSelection: boolean
  tagStats: readonly { name: string; count: number }[]
}>()

const filters = defineModel<FavoriteFilterState>({ required: true })

type TextFilterKey =
  | 'titleQuery'
  | 'artistQuery'
  | 'regularPublishedFrom'
  | 'regularPublishedTo'
  | 'regularTag'
  | 'customCreatedFrom'
  | 'customCreatedTo'

const artistPlaceholder = computed(() => {
  if (props.hasCustomSelection && !props.hasRegularSelection) return '来源博主名称 / 用户 ID'
  if (props.hasCustomSelection) return '博主、创作者或用户 ID'
  return '博主名称 / 用户 ID'
})

function updateTextFilter(key: TextFilterKey, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return
  filters.value = { ...filters.value, [key]: target.value }
}
const tags = useUiContributionAvailability('trackList.filters')
</script>

<template>
  <p v-if="(!tags.allows('tag-filter') || filters.tagsDormant) && filters.regularTag" role="status">
    休眠标签条件：{{ filters.regularTag }}（当前不参与筛选）<button
      v-if="tags.allows('tag-filter')"
      type="button"
      @click="filters = { ...filters, tagsDormant: false }"
    >
      恢复标签条件
    </button>
  </p>
  <div
    v-if="props.hasRegularSelection || props.hasCustomSelection"
    class="favorites-filter"
    aria-label="已选平台筛选"
  >
    <input
      class="favorites-filter__input"
      :value="filters.titleQuery"
      aria-label="按歌曲名称筛选"
      placeholder="歌曲名称"
      @input="updateTextFilter('titleQuery', $event)"
    />
    <input
      class="favorites-filter__input"
      :value="filters.artistQuery"
      aria-label="按作者或用户 ID 筛选"
      :placeholder="artistPlaceholder"
      @input="updateTextFilter('artistQuery', $event)"
    />

    <template v-if="props.hasRegularSelection">
      <select
        v-if="tags.allows('tag-filter')"
        class="favorites-filter__input"
        :value="filters.regularTag"
        aria-label="按普通音乐标签筛选"
        @change="updateTextFilter('regularTag', $event)"
      >
        <option value="">全部标签</option>
        <option v-for="tag in props.tagStats" :key="tag.name" :value="tag.name">
          {{ tag.name }} ({{ tag.count }})
        </option>
      </select>
      <label class="favorites-filter__date">
        发布时间从
        <input
          type="date"
          :value="filters.regularPublishedFrom"
          @input="updateTextFilter('regularPublishedFrom', $event)"
        />
      </label>
      <label class="favorites-filter__date">
        到
        <input
          type="date"
          :value="filters.regularPublishedTo"
          @input="updateTextFilter('regularPublishedTo', $event)"
        />
      </label>
    </template>

    <template v-if="props.hasCustomSelection">
      <label class="favorites-filter__date">
        拼接时间从
        <input
          type="date"
          :value="filters.customCreatedFrom"
          @input="updateTextFilter('customCreatedFrom', $event)"
        />
      </label>
      <label class="favorites-filter__date">
        到
        <input
          type="date"
          :value="filters.customCreatedTo"
          @input="updateTextFilter('customCreatedTo', $event)"
        />
      </label>
    </template>
  </div>
</template>
