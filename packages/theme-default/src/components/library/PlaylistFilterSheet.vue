<script setup lang="ts">
import BottomSheet from '@any-music/ui/components/BottomSheet.vue'
import type { FavoriteFilterState, FavoritePlatformOption } from '@any-music/ui/library'
import { createFavoriteFilterState } from '@any-music/ui/library'
import type { PlaylistFilterState } from '@any-music/ui/library'
import { computed } from 'vue'

import FavoriteFilterBar from './FavoriteFilterBar.vue'

/** 平台与歌曲条件在同一草稿内编辑；关闭丢弃草稿，应用才改变歌曲页。 */
const props = defineProps<{
  open: boolean
  platformOptions: readonly FavoritePlatformOption[]
  hasRegularSelection: boolean
  hasCustomSelection: boolean
  tagStats: readonly { name: string; count: number }[]
}>()
const emit = defineEmits<{ close: []; apply: [] }>()
const filters = defineModel<PlaylistFilterState>({ required: true })

const sharedFilters = computed<FavoriteFilterState>({
  get: () => filters.value,
  set: (value) => {
    filters.value = { ...filters.value, ...value }
  },
})

function togglePlatform(platformId: string): void {
  const selectedIds = new Set(filters.value.selectedPlatformIds)
  if (selectedIds.has(platformId)) selectedIds.delete(platformId)
  else selectedIds.add(platformId)
  filters.value = { ...filters.value, selectedPlatformIds: [...selectedIds] }
}

function clearFilters(): void {
  filters.value = {
    ...createFavoriteFilterState(props.platformOptions.map((platform) => platform.id)),
    arrangementMode: filters.value.arrangementMode,
    favoriteOnly: false,
    durationRange: 'any',
  }
}
</script>

<template>
  <BottomSheet
    :open="props.open"
    title="筛选歌单歌曲"
    description="平台与其他条件一起生效；关闭面板不会改变当前结果。"
    size="content"
    @close="emit('close')"
  >
    <div class="playlist-filters">
      <section class="playlist-filters__group" aria-label="平台筛选">
        <div class="playlist-filters__heading">
          <h3>平台</h3>
          <button
            type="button"
            @click="
              filters = {
                ...filters,
                selectedPlatformIds: props.platformOptions.map((platform) => platform.id),
              }
            "
          >
            全选
          </button>
        </div>
        <div class="playlist-filters__platforms">
          <button
            v-for="platform in props.platformOptions"
            :key="platform.id"
            type="button"
            :aria-pressed="filters.selectedPlatformIds.includes(platform.id)"
            @click="togglePlatform(platform.id)"
          >
            {{ platform.name }} <small>{{ platform.count }}</small>
          </button>
        </div>
      </section>

      <section class="playlist-filters__group" aria-label="歌曲条件">
        <h3>歌曲信息</h3>
        <FavoriteFilterBar
          v-model="sharedFilters"
          :has-regular-selection="props.hasRegularSelection"
          :has-custom-selection="props.hasCustomSelection"
          :tag-stats="props.tagStats"
        />
        <p v-if="filters.selectedPlatformIds.length === 0" class="playlist-filters__hint">
          选择至少一个平台后可设置歌曲信息。
        </p>
      </section>

      <section class="playlist-filters__group" aria-label="收藏与时长">
        <h3>收藏与时长</h3>
        <label class="playlist-filters__check">
          <input
            type="checkbox"
            :checked="filters.favoriteOnly"
            @change="filters = { ...filters, favoriteOnly: !filters.favoriteOnly }"
          />
          只看已喜欢的歌曲
        </label>
        <label class="playlist-filters__duration">
          歌曲时长
          <select
            :value="filters.durationRange"
            @change="
              filters = {
                ...filters,
                durationRange: ($event.target as HTMLSelectElement)
                  .value as PlaylistFilterState['durationRange'],
              }
            "
          >
            <option value="any">不限时长</option>
            <option value="short">4 分钟以内</option>
            <option value="medium">4–15 分钟</option>
            <option value="long">15 分钟以上</option>
          </select>
        </label>
        <small class="playlist-filters__hint">时长未知的歌曲仅在“不限时长”中显示。</small>
      </section>
    </div>
    <template #footer>
      <div class="playlist-filters__footer">
        <button type="button" @click="clearFilters">清空条件</button>
        <span></span>
        <button type="button" @click="emit('close')">取消</button>
        <button class="playlist-filters__apply" type="button" @click="emit('apply')">
          应用筛选
        </button>
      </div>
    </template>
  </BottomSheet>
</template>

<style scoped>
.playlist-filters {
  display: grid;
  gap: var(--am-space-5);
}
.playlist-filters__group {
  display: grid;
  gap: var(--am-space-3);
}
.playlist-filters__group h3 {
  margin: 0;
  font-size: var(--am-font-size-md);
}
.playlist-filters__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.playlist-filters__heading button {
  border: 0;
  background: transparent;
  color: var(--am-color-primary);
  cursor: pointer;
  font: inherit;
}
.playlist-filters__platforms {
  display: flex;
  flex-wrap: wrap;
  gap: var(--am-space-2);
}
.playlist-filters__platforms button {
  min-block-size: 44px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-pill);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
}
.playlist-filters__platforms button[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
}
.playlist-filters__platforms button:focus-visible,
.playlist-filters__footer button:focus-visible,
.playlist-filters__heading button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.playlist-filters__platforms small {
  margin-inline-start: var(--am-space-1);
}
.playlist-filters__check {
  display: flex;
  min-block-size: 44px;
  align-items: center;
  gap: var(--am-space-2);
}
.playlist-filters__check input {
  inline-size: 18px;
  block-size: 18px;
  accent-color: var(--am-color-primary);
}
.playlist-filters__duration {
  display: flex;
  align-items: center;
  gap: var(--am-space-3);
}
.playlist-filters__duration select {
  min-block-size: 44px;
  padding-inline: var(--am-space-2);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
}
.playlist-filters__hint {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.playlist-filters :deep(.favorites-filter) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 0;
  border: 0;
}
.playlist-filters :deep(.favorites-filter__input),
.playlist-filters :deep(.favorites-filter__date input) {
  min-block-size: 44px;
}
.playlist-filters__footer {
  display: flex;
  inline-size: 100%;
  align-items: center;
  gap: var(--am-space-2);
}
.playlist-filters__footer span {
  flex: 1;
}
.playlist-filters__footer button {
  min-block-size: 44px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
}
.playlist-filters__footer .playlist-filters__apply {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
@container am-bottom-sheet (max-width: 440px) {
  .playlist-filters :deep(.favorites-filter) {
    grid-template-columns: 1fr;
  }
  .playlist-filters__footer {
    flex-wrap: wrap;
  }
  .playlist-filters__footer span {
    flex-basis: 100%;
  }
}
</style>
