<script setup lang="ts">
import type { CatalogTagStat } from '@any-music/ui/catalog'
import { formatPlaylistTrackCountRange } from '@any-music/ui/library'
import type {
  PlaylistOverviewFilters,
  PlaylistOverviewFilterDimension,
} from '@any-music/ui/library'
import { computed, nextTick, onMounted, useId, useTemplateRef } from 'vue'

import CatalogFilterRangeList from '../music-sources/CatalogFilterRangeList.vue'
import CollectionFilterChoices from '../music-sources/CollectionFilterChoices.vue'

const props = defineProps<{
  dimension: PlaylistOverviewFilterDimension
  editingIndex?: number
  countError: string
  canAddRange: boolean
  tagStats: readonly CatalogTagStat[]
  visibleTagStats: readonly CatalogTagStat[]
  tagsEnabled: boolean
  coverOptions: readonly {
    value: PlaylistOverviewFilters['cover'][number]
    label: string
    description: string
  }[]
}>()
const emit = defineEmits<{
  confirm: []
  addRange: []
  editRange: [index: number]
  removeRange: [index: number]
}>()
const local = defineModel<PlaylistOverviewFilters>('filters', { required: true })
const tagQuery = defineModel<string>('tagQuery', { required: true })
const minimumCount = defineModel<string>('minimumCount', { required: true })
const maximumCount = defineModel<string>('maximumCount', { required: true })
const root = useTemplateRef<HTMLElement>('root')
const editorId = useId()
const rangeLabels = computed(() => local.value.trackCountRanges.map(formatPlaylistTrackCountRange))
function focusInitialControl() {
  root.value?.querySelector<HTMLElement>('[data-editor-focus]')?.focus({ preventScroll: true })
}
// Start the focus underline with entry, matching the Discover editor.
onMounted(focusInitialControl)
function toggleTag(tag: string) {
  if (!props.tagsEnabled) return
  const tags = new Set(local.value.tags)
  if (tags.has(tag)) tags.delete(tag)
  else tags.add(tag)
  local.value = { ...local.value, tags: [...tags], tagsDormant: undefined }
}
async function removeRange(index: number) {
  emit('removeRange', index)
  await nextTick()
  const nextIndex = Math.min(index, rangeLabels.value.length - 1)
  root.value
    ?.querySelector<HTMLElement>(`[data-range-edit="${nextIndex}"]`)
    ?.focus({ preventScroll: true })
  if (nextIndex < 0) focusInitialControl()
}
</script>

<template>
  <div
    ref="root"
    class="catalog-filter-editor"
    :class="{ 'catalog-filter-editor--search': dimension === 'keyword' }"
  >
    <form
      v-if="dimension === 'keyword'"
      class="catalog-filter-editor__search"
      role="search"
      @submit.prevent="emit('confirm')"
    >
      <label :for="`${editorId}-search`" class="catalog-filter-editor__label">歌单名称或简介</label>
      <span class="catalog-filter-editor__input-control">
        <input
          :id="`${editorId}-search`"
          v-model="local.keyword"
          class="catalog-filter-editor__line-input catalog-filter-editor__search-input"
          type="search"
          autocomplete="off"
          inputmode="search"
          maxlength="120"
          placeholder="输入歌单名称或简介"
          data-editor-focus
        />
      </span>
    </form>
    <template v-else-if="dimension === 'tags'">
      <p v-if="!tagsEnabled" class="catalog-filter-editor__empty">
        标签功能已停用，已选条件保留但不参与筛选。
      </p>
      <p v-else-if="tagStats.length === 0" class="catalog-filter-editor__empty">
        已有歌单还没有用户标签。
      </p>
      <template v-else>
        <label class="catalog-filter-editor__field">
          <span>搜索标签</span>
          <span class="catalog-filter-editor__input-control"
            ><input
              v-model="tagQuery"
              class="catalog-filter-editor__line-input"
              type="search"
              autocomplete="off"
              placeholder="输入标签名称"
              data-editor-focus
          /></span>
        </label>
        <p v-if="visibleTagStats.length === 0" class="catalog-filter-editor__empty">
          未找到匹配标签。
        </p>
        <div v-else class="catalog-filter-editor__tags">
          <label v-for="tag in visibleTagStats" :key="tag.name" class="catalog-filter-tag">
            <input
              type="checkbox"
              :checked="local.tags.includes(tag.name)"
              @change="toggleTag(tag.name)"
            />
            <span>{{ tag.name }}</span
            ><small>{{ tag.count }} 个歌单</small>
          </label>
        </div>
      </template>
    </template>
    <div v-else-if="dimension === 'trackCountRanges'" class="catalog-filter-editor__split">
      <form class="catalog-filter-editor__duration" @submit.prevent="emit('addRange')">
        <label class="catalog-filter-editor__field">
          <span>最少（首）</span>
          <span class="catalog-filter-editor__input-control"
            ><input
              v-model="minimumCount"
              class="catalog-filter-editor__line-input"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="不限"
              aria-label="最少歌曲数量（首）"
              :aria-invalid="Boolean(countError)"
              :aria-describedby="countError ? `${editorId}-count-error` : undefined"
              data-editor-focus
          /></span>
        </label>
        <label class="catalog-filter-editor__field">
          <span>最多（首）</span>
          <span class="catalog-filter-editor__input-control"
            ><input
              v-model="maximumCount"
              class="catalog-filter-editor__line-input"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="不限"
              aria-label="最多歌曲数量（首）"
              :aria-invalid="Boolean(countError)"
              :aria-describedby="countError ? `${editorId}-count-error` : undefined"
          /></span>
        </label>
        <p
          v-if="countError"
          :id="`${editorId}-count-error`"
          class="catalog-filter-editor__error"
          role="alert"
        >
          {{ countError }}
        </p>
        <button type="submit" class="catalog-filter-editor__add" :disabled="!canAddRange">
          {{ editingIndex === undefined ? '加入数量段' : '更新数量段' }}
        </button>
      </form>
      <aside class="catalog-filter-editor__aside" aria-label="歌曲数量范围">
        <CatalogFilterRangeList
          title="已选歌曲数量"
          :labels="rangeLabels"
          :editing-index="editingIndex"
          @edit="emit('editRange', $event)"
          @remove="removeRange"
        />
      </aside>
    </div>
    <CollectionFilterChoices
      v-else
      v-model="local.cover"
      multiple
      label="歌单封面"
      :all-option="{ label: '全部封面', description: '不限封面设置状态' }"
      :options="coverOptions"
    />
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/catalog-filter-editor';
@include catalog-filter-editor.editor;
</style>
