<script setup lang="ts">
import type { FavoriteFilterState } from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed } from 'vue'
const props = defineProps<{ feature: UiThemeFeatureMap['favorites'] }>()
const draft = computed(() => props.feature.state.favoriteFilterDraft)
const fields = [
  ['titleQuery', '歌曲名称'],
  ['artistQuery', '作者名称'],
  ['regularTag', '普通歌曲标签'],
  ['regularPublishedFrom', '发布起始日期'],
  ['regularPublishedTo', '发布结束日期'],
  ['customCreatedFrom', '作品创建起始日期'],
  ['customCreatedTo', '作品创建结束日期'],
] as const
function set<Key extends keyof FavoriteFilterState>(key: Key, value: FavoriteFilterState[Key]) {
  if (draft.value) props.feature.actions.setFavoriteFilterDraft({ ...draft.value, [key]: value })
}
function toggle(id: string) {
  if (!draft.value) return
  const ids = new Set(draft.value.selectedPlatformIds)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  set('selectedPlatformIds', [...ids])
}
</script>
<template>
  <section v-if="draft" class="studio-filter" aria-label="喜欢的平台与歌曲条件">
    <h3>喜欢的平台与歌曲条件</h3>
    <label v-for="[id, name] in feature.state.platformNames" :key="id"
      ><input
        type="checkbox"
        :checked="draft.selectedPlatformIds.includes(id)"
        @change="toggle(id)"
      />{{ name }}</label
    ><label
      >排列<select
        :value="draft.arrangementMode"
        @change="
          set(
            'arrangementMode',
            ($event.target as HTMLSelectElement).value as 'collapsed' | 'mixed',
          )
        "
      >
        <option value="collapsed">按平台分组</option>
        <option value="mixed">混合排列</option>
      </select></label
    ><label v-for="[key, title] in fields" :key="key" class="studio-field"
      >{{ title
      }}<input
        :type="key.includes('From') || key.includes('To') ? 'date' : 'search'"
        :value="draft[key]"
        :disabled="key === 'regularTag' && draft.tagsDormant"
        @input="set(key, ($event.target as HTMLInputElement).value)"
    /></label>
    <p v-if="draft.tagsDormant" role="status">标签条件已暂停。</p>
    <button type="button" @click="feature.actions.cancelFavoriteFilters">取消</button
    ><button type="button" @click="feature.actions.applyFavoriteFilters">应用条件</button>
  </section>
</template>
