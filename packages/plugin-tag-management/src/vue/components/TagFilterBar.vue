<script lang="ts">
import { editingStateKey } from '@any-music/ui'
import type { ShallowRef } from 'vue'
type Dimension = 'search' | 'platforms' | 'usage' | 'scope' | 'sort'
const dimensionKey = editingStateKey<ShallowRef<Dimension | null>>('tags:filter-dimension')
</script>

<script setup lang="ts">
import { useEditingSession } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { TagManagementFilterState, TagPlatformOption } from '@any-music/ui/theme'
import { computed, shallowRef } from 'vue'

import { createTagManagementFilterState } from '../use-tag-management-filters'

const props = defineProps<{
  platformOptions?: readonly TagPlatformOption[]
  taggedTrackCount: number
  entityKind?: 'tracks' | 'playlists'
  taggedPlaylistCount?: number
  tagCount: number
}>()
const filters = defineModel<TagManagementFilterState>({ required: true })
const active = useEditingSession('tag-filter').state(dimensionKey, () =>
  shallowRef<Dimension | null>(null),
)
const subject = computed(() => (props.entityKind === 'playlists' ? '歌单' : '歌曲'))
const unit = computed(() => (props.entityKind === 'playlists' ? '个' : '首'))
const dimensions = computed(
  () =>
    [
      { id: 'search', label: '标签名称', description: '按名称关键词查找标签', icon: 'search' },
      {
        id: 'platforms',
        label: '关联平台',
        description: `保留关联所选平台${subject.value}的标签`,
        icon: 'music',
      },
      {
        id: 'usage',
        label: `关联${subject.value}`,
        description: `按标签关联的${subject.value}数量筛选`,
        icon: 'library',
      },
      { id: 'scope', label: '平台覆盖', description: '区分单个平台与跨平台标签', icon: 'tags' },
      {
        id: 'sort',
        label: '排序方式',
        description: '可多选，按选择先后确定排序优先级；默认按最近维护排序',
        icon: 'list',
      },
    ] as const,
)
const current = computed(() => dimensions.value.find(({ id }) => id === active.value))
const usageOptions = computed(
  () =>
    [
      { id: 'single', label: `仅关联一${unit.value}` },
      { id: 'multiple', label: `关联多${unit.value}` },
    ] as const,
)
const scopeOptions = [
  { id: 'single', label: '单个平台' },
  { id: 'multiple', label: '跨平台' },
] as const
const sortOptions = computed(
  () =>
    [
      { id: 'updated-desc', label: '最近维护' },
      { id: 'name-asc', label: '标签名称' },
      { id: 'usage-desc', label: `关联${subject.value}最多` },
    ] as const,
)
const summary = computed(() =>
  [
    filters.value.searchQuery.trim() ? `名称包含“${filters.value.searchQuery.trim()}”` : '',
    filters.value.selectedPlatformIds.length
      ? `已选 ${filters.value.selectedPlatformIds.length} 个关联平台`
      : '',
    ...filters.value.usage.map((value) => usageOptions.value.find(({ id }) => id === value)?.label),
    ...filters.value.platformScope.map(
      (value) => scopeOptions.find(({ id }) => id === value)?.label,
    ),
    `排序：${filters.value.sortMode.length ? filters.value.sortMode.map((value) => sortOptions.value.find(({ id }) => id === value)?.label).join(' → ') : '最近维护'}`,
  ].filter(Boolean),
)
function togglePlatform(id: string): void {
  const ids = new Set(filters.value.selectedPlatformIds)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  filters.value = { ...filters.value, selectedPlatformIds: [...ids] }
}
function reset(): void {
  filters.value = createTagManagementFilterState()
}
function toggleChoice<Key extends 'usage' | 'platformScope' | 'sortMode'>(
  key: Key,
  value: TagManagementFilterState[Key][number],
): void {
  const selected: readonly string[] = filters.value[key]
  filters.value = {
    ...filters.value,
    [key]: selected.includes(value)
      ? selected.filter((candidate) => candidate !== value)
      : [...selected, value],
  }
}
function updateSearch(event: Event): void {
  filters.value = { ...filters.value, searchQuery: (event.target as HTMLInputElement).value }
}
</script>

<template>
  <section class="tag-filter-shell" aria-label="标签筛选器">
    <div class="tag-filter">
      <nav class="tag-filter__dimensions" aria-label="标签筛选类型">
        <button type="button" :aria-pressed="active === null" @click="active = null">
          <AppIcon name="filter" :size="18" />筛选概览
        </button>
        <button
          v-for="dimension in dimensions"
          :key="dimension.id"
          type="button"
          :aria-pressed="active === dimension.id"
          @click="active = dimension.id"
        >
          <AppIcon :name="dimension.icon" :size="18" />{{ dimension.label
          }}<AppIcon name="arrow-right" :size="14" />
        </button>
      </nav>
      <div class="tag-filter__content">
        <header class="tag-filter__heading">
          <div>
            <strong>{{ current?.label ?? '筛选概览' }}</strong>
            <p>
              {{
                current?.description ??
                `条件同时生效；应用后更新标签列表。${subject}数量与覆盖范围按完整关联统计。`
              }}
            </p>
          </div>
          <button type="button" @click="reset">重置条件</button>
        </header>
        <template v-if="!current">
          <dl class="tag-filter__stats">
            <div>
              <dt>我的标签</dt>
              <dd>{{ tagCount }} 个</dd>
            </div>
            <div>
              <dt>已标记{{ entityKind === 'playlists' ? '歌单' : '音乐' }}</dt>
              <dd>
                {{ entityKind === 'playlists' ? taggedPlaylistCount : taggedTrackCount }} {{ unit }}
              </dd>
            </div>
            <div>
              <dt>覆盖平台</dt>
              <dd>{{ platformOptions?.filter(({ count }) => count > 0).length ?? 0 }} 个</dd>
            </div>
          </dl>
          <div class="tag-filter__summary">
            <strong>当前条件</strong>
            <p v-for="label in summary" :key="label">{{ label }}</p>
            <small>选择筛选类型以编辑条件；关联平台满足任一即可。</small>
          </div>
        </template>
        <label v-else-if="active === 'search'" class="tag-filter__field"
          >标签名称<input
            class="tag-filter__input"
            type="search"
            :value="filters.searchQuery"
            placeholder="搜索标签名称"
            aria-label="搜索标签名称"
            @input="updateSearch"
        /></label>
        <div
          v-else-if="active === 'platforms'"
          class="tag-filter__options"
          role="group"
          aria-label="关联平台"
        >
          <button
            type="button"
            :aria-pressed="filters.selectedPlatformIds.length === 0"
            @click="filters = { ...filters, selectedPlatformIds: [] }"
          >
            全部关联平台
          </button>
          <button
            v-for="platform in platformOptions"
            :key="platform.id"
            type="button"
            :aria-pressed="filters.selectedPlatformIds.includes(platform.id)"
            @click="togglePlatform(platform.id)"
          >
            {{ platform.name }}<small>{{ platform.count }} {{ unit }}已标记</small>
          </button>
          <p class="tag-filter__empty">
            未选择时显示全部平台；多选时匹配任一平台，不改变标签的全局{{ subject }}数量。
          </p>
        </div>
        <div
          v-else-if="active === 'usage'"
          class="tag-filter__options"
          role="group"
          :aria-label="`关联${subject}数量`"
        >
          <button
            type="button"
            :aria-pressed="filters.usage.length === 0"
            @click="filters = { ...filters, usage: [] }"
          >
            全部{{ subject }}数量
          </button>
          <button
            v-for="option in usageOptions"
            :key="option.id"
            type="button"
            :aria-pressed="filters.usage.includes(option.id)"
            @click="toggleChoice('usage', option.id)"
          >
            {{ option.label }}
          </button>
        </div>
        <div
          v-else-if="active === 'scope'"
          class="tag-filter__options"
          role="group"
          aria-label="平台覆盖范围"
        >
          <button
            type="button"
            :aria-pressed="filters.platformScope.length === 0"
            @click="filters = { ...filters, platformScope: [] }"
          >
            全部平台覆盖
          </button>
          <button
            v-for="option in scopeOptions"
            :key="option.id"
            type="button"
            :aria-pressed="filters.platformScope.includes(option.id)"
            @click="toggleChoice('platformScope', option.id)"
          >
            {{ option.label }}
          </button>
        </div>
        <div v-else class="tag-filter__options" role="group" aria-label="标签排序方式">
          <button
            type="button"
            :aria-pressed="filters.sortMode.length === 0"
            @click="filters = { ...filters, sortMode: [] }"
          >
            全部排序方式
          </button>
          <button
            v-for="option in sortOptions"
            :key="option.id"
            type="button"
            :aria-pressed="filters.sortMode.includes(option.id)"
            @click="toggleChoice('sortMode', option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
