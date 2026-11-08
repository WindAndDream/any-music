<script setup lang="ts">
import {
  useEditingSession,
  provideEditingSession,
  useCatalogDrawerList,
  useConfirmAction,
  catalogRootEditingKey,
  createCatalogRootEditing,
} from '@any-music/ui/catalog'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed } from 'vue'

import StudioFilters from '../library/StudioFilters.vue'
import StudioRequestOptions from './StudioRequestOptions.vue'

const props = defineProps<{ feature: UiThemeFeatureMap['catalog'] }>()
const { listFilterOpen } = useEditingSession().state(
  catalogRootEditingKey,
  createCatalogRootEditing,
)
const editing = useEditingSession('catalog-lists')
const model = useCatalogDrawerList({
  drawers: () => props.feature.state.drawers,
  invalidTrackIds: () => new Set(props.feature.state.invalidTrackIds),
  filterOpen: listFilterOpen,
  confirm: useConfirmAction(),
  removeMany: (ids) => ids.forEach((id) => props.feature.actions.removeDrawer(id)),
  restoreNames: (ids) => props.feature.actions.restoreDrawerNames(ids),
})
provideEditingSession(editing)
const {
  stateFilter,
  controls,
  summary,
  requestRemoveSelectedDrawers,
  requestRestoreSelectedNames,
} = model
const visible = computed(() => controls.visibleItems.value)
const filterState = computed(() => ({
  tracks: [],
  filters: model.filters.value,
  filterDraft: listFilterOpen.value ? model.filterDraft.value : null,
  platformNames: new Map(model.platformStats.value.map((item) => [item.id, item.name])),
  customTagsByTrackId: new Map<string, readonly string[]>(),
}))
const filterActions = {
  setFilterDraft: (value: typeof model.filterDraft.value | null) => {
    if (value) model.filterDraft.value = value
  },
  applyFilters: () => {
    model.applyFilterDraft()
    listFilterOpen.value = false
  },
  cancelFilters: () => {
    listFilterOpen.value = false
  },
}
const statuses = [
  ['all', '全部'],
  ['available', '可用'],
  ['unavailable', '不可用'],
  ['attention', '需处理'],
] as const
</script>

<template>
  <aside class="studio-requests" aria-label="音乐列表" data-am-scroll-key="catalog:requests">
    <h2>
      音乐列表 <small>{{ feature.state.drawers.length }}</small>
    </h2>
    <p v-if="!feature.state.drawers.length">搜索或导入后，音乐列表会保存在这里。</p>
    <div class="studio-actions">
      <button
        v-for="[id, title] in statuses"
        :key="id"
        type="button"
        :aria-pressed="stateFilter === id"
        @click="stateFilter = id"
      >
        {{ title }}</button
      ><button type="button" @click="listFilterOpen = true">筛选音乐列表</button
      ><label
        ><input
          type="checkbox"
          :checked="controls.areAllVisibleSelected.value"
          @change="controls.toggleAllVisible"
        />全选音乐列表</label
      ><span>已选 {{ summary.selectedCount }}</span
      ><button
        type="button"
        :disabled="!summary.selectedCount"
        @click="requestRemoveSelectedDrawers"
      >
        删除已选列表</button
      ><button
        type="button"
        :disabled="!summary.selectedCount"
        @click="requestRestoreSelectedNames"
      >
        恢复已选列表原名
      </button>
    </div>
    <StudioFilters
      context="drawers"
      v-if="listFilterOpen"
      :state="filterState"
      :actions="filterActions"
      scope="catalog:drawers"
      :editing="editing"
    />
    <p v-if="feature.state.drawers.length && !visible.length">没有匹配的音乐列表。</p>
    <ol class="studio-request-list">
      <li
        v-for="drawer in visible"
        :key="drawer.id"
        :data-active="drawer.id === feature.state.activeDrawerId"
      >
        <button
          type="button"
          :aria-current="drawer.id === feature.state.activeDrawerId ? 'true' : undefined"
          :data-am-focus-key="`catalog:drawer:${drawer.id}`"
          @click="feature.actions.openDrawer(drawer.id)"
        >
          <strong>{{ drawer.title }}</strong
          ><span
            >{{ drawer.pluginName }} · {{ drawer.tracks.length }} 首 ·
            {{ drawer.loadedPageCount }} 页</span
          ><span v-if="drawer.isPinned">已置顶</span>
        </button>
        <p v-if="!drawer.isSourceEnabled" role="status">音乐源不可用，已加载的歌曲仍可浏览。</p>
        <p v-if="drawer.errorMessage || drawer.invalidReason" role="alert">
          {{ drawer.errorMessage || drawer.invalidReason }}
        </p>
        <p v-if="drawer.isLoading" role="status">正在加载…</p>
        <div class="studio-actions">
          <label
            ><input
              type="checkbox"
              :aria-label="`选择音乐列表 ${drawer.title}`"
              :checked="controls.selectedIds.value.has(drawer.id)"
              @change="controls.toggleItem(drawer.id)"
            />选择列表</label
          >
          <button v-if="drawer.isLoading" type="button" @click="feature.actions.cancel(drawer.id)">
            取消加载
          </button>
          <button
            v-else
            type="button"
            :disabled="!drawer.isSourceEnabled || feature.availability.status !== 'available'"
            @click="feature.actions.retry(drawer.id)"
          >
            重试加载
          </button>
          <button
            v-if="drawer.canVerify && !drawer.isVerifying"
            type="button"
            @click="feature.actions.verify(drawer.id)"
          >
            验证账号
          </button>
          <button
            v-if="drawer.isVerifying"
            type="button"
            @click="feature.actions.cancelVerification(drawer.id)"
          >
            取消验证
          </button>
          <button
            type="button"
            :aria-pressed="Boolean(drawer.isPinned)"
            @click="feature.actions.pinDrawer(drawer.id, !drawer.isPinned)"
          >
            {{ drawer.isPinned ? '取消置顶' : '置顶' }}
          </button>
        </div>
        <StudioRequestOptions
          :feature="feature"
          :drawer="drawer"
          :index="feature.state.drawers.findIndex((item) => item.id === drawer.id)"
        />
      </li>
    </ol>
  </aside>
</template>
