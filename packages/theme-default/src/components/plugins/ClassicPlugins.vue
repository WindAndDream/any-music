<script setup lang="ts">
import type { PluginCenterDisplay } from '@any-music/ui'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import MusicListEmptyState from '@any-music/ui/components/music-sources/MusicListEmptyState.vue'
import PluginDetailsDialog from '@any-music/ui/components/plugins/PluginDetailsDialog.vue'
import PluginDisplayOptions from '@any-music/ui/components/plugins/PluginDisplayOptions.vue'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, shallowRef, watch } from 'vue'

import { useClassicPlugins } from '../../composables/use-classic-plugins'
import ClassicCollectionControls from '../library/ClassicCollectionControls.vue'
import ClassicCollectionSurface from '../library/ClassicCollectionSurface.vue'
import ClassicFeatureStatus from '../library/ClassicFeatureStatus.vue'
import ClassicResultView from '../library/ClassicResultView.vue'
import CatalogOperatorActions from '../music-sources/CatalogOperatorActions.vue'
import ClassicPageOverlays from '../overlays/ClassicPageOverlays.vue'
import ClassicPluginCard from './ClassicPluginCard.vue'
import PluginFilters from './PluginFilters.vue'
import PluginOperator from './PluginOperator.vue'
import PluginSummary from './PluginSummary.vue'

const props = defineProps<{ feature: UiThemeFeatureMap['plugins']; mobileLayout?: boolean }>()
const {
  filter,
  display,
  counts,
  visible,
  filters: criteria,
  draft,
  preview,
  categories,
  controls,
  selected,
  displayOpen,
  detailsId,
  details,
  operatorOpen,
  modalOpen,
  disabled,
  canEnable,
  canDisable,
  applyFilters,
  setSelectedEnabled,
} = useClassicPlugins(props)
const filterCount = computed(() => {
  const { keyword, category, status, developmentStatus } = criteria.value
  return (
    Number(Boolean(keyword.trim())) + category.length + status.length + developmentStatus.length
  )
})
function selectDisplay(value: PluginCenterDisplay): void {
  display.value = value
  displayOpen.value = false
}
watch(
  () => props.mobileLayout,
  (mobile) => {
    if (mobile) displayOpen.value = false
  },
)
const filters = [
  { id: 'all', title: '全部' },
  { id: 'builtin', title: '内置' },
  { id: 'external', title: '外置' },
] as const
const slideDirection = shallowRef<'forward' | 'back'>('forward')
watch(
  filter,
  (next, previous) => {
    slideDirection.value =
      filters.findIndex(({ id }) => id === next) > filters.findIndex(({ id }) => id === previous)
        ? 'forward'
        : 'back'
  },
  { flush: 'sync' },
)
function setEnabled(id: string, enabled: boolean): void {
  if (!disabled.value) void props.feature.actions.setEnabled(id, enabled)
}
function manageDetails(): void {
  if (!details.value || disabled.value) return
  const id = details.value.id
  detailsId.value = undefined
  void props.feature.actions.manageExternal(id)
}
</script>

<template>
  <section
    class="listen-queue classic-plugins"
    :data-mobile-layout="!!mobileLayout"
    aria-label="插件中心"
  >
    <ClassicFeatureStatus :availability="feature.availability" :status="feature.status" />
    <ClassicCollectionSurface
      title="插件中心"
      :total-count="counts.all"
      count-unit="个"
      :mobile-layout="!!mobileLayout"
      :detail="false"
      :empty="!visible.length"
    >
      <template #count>
        <PluginSummary :items="feature.state.items" />
      </template>
      <template #controls>
        <div class="classic-plugins__toolbar">
          <CatalogOperatorActions
            class="classic-plugins__filters"
            role="group"
            aria-label="插件分类"
            align="start"
            forward-label="查看更多插件分类"
            back-label="返回前面的插件分类"
          >
            <div
              class="classic-plugins__categories"
              :style="{
                '--am-state-tab-index': filters.findIndex(({ id }) => id === filter),
              }"
            >
              <button
                v-for="option in filters"
                :key="option.id"
                type="button"
                :aria-pressed="filter === option.id"
                @click="filter = option.id"
              >
                {{ option.title }} {{ counts[option.id] }}
              </button>
            </div>
          </CatalogOperatorActions>
          <button
            class="classic-plugins__import"
            type="button"
            aria-haspopup="dialog"
            :disabled="!feature.state.externalSupported || disabled"
            :title="
              feature.state.externalSupported ? '导入插件包并确认安装' : '当前运行端不支持外置插件'
            "
            @click="feature.actions.importPlugin()"
          >
            <AppIcon name="import" :size="16" />导入
          </button>
        </div>
      </template>
      <p v-if="feature.state.errorMessage" class="classic-plugins__notice" role="alert">
        {{ feature.state.errorMessage }}
        <button type="button" :disabled="feature.state.busy" @click="feature.actions.refresh()">
          重新读取
        </button>
      </p>
      <p v-if="feature.state.busy" class="classic-plugins__hint" role="status">正在更新外置插件…</p>
      <p
        v-if="filter === 'external' && !feature.state.externalSupported"
        class="classic-plugins__hint"
        role="status"
      >
        当前运行端不支持外置插件，可使用内置插件。
      </p>
      <div class="classic-plugins__category-viewport">
        <ClassicResultView
          class="classic-plugins__fields"
          as="fieldset"
          :view-key="filter"
          :reverse="slideDirection === 'back'"
          :disabled="disabled"
        >
          <legend class="am-sr-only">插件列表</legend>
          <div
            v-if="visible.length"
            class="classic-plugins__items"
            :data-display="mobileLayout ? 'grid' : display"
          >
            <ClassicPluginCard
              v-for="item in visible"
              :key="item.id"
              :item="item"
              :busy="disabled"
              :selectable="operatorOpen"
              :selected="controls.selectedIds.value.has(item.id)"
              @select="controls.toggleItem(item.id)"
              @set-enabled="setEnabled(item.id, $event)"
              @details="detailsId = item.id"
            />
          </div>
          <MusicListEmptyState
            v-else
            icon="plugin"
            role="status"
            :title="
              counts[filter]
                ? '没有匹配的插件'
                : filter === 'external'
                  ? '还没有外置插件'
                  : '暂无可用插件'
            "
          >
            {{
              counts[filter]
                ? '调整筛选条件，或切换分类查看其他插件。'
                : filter === 'external' && feature.state.externalSupported
                  ? '从右上角导入插件包，确认安装后即可在这里管理。'
                  : '可切换分类查看其他插件。'
            }}
          </MusicListEmptyState>
        </ClassicResultView>
      </div>
    </ClassicCollectionSurface>
    <ClassicPageOverlays :modal-open="modalOpen">
      <template #toolbar>
        <ClassicCollectionControls
          :selected-count="selected.length"
          :total-count="visible.length"
          :operator-open="operatorOpen"
          :filter-count="filterCount"
          :disabled="disabled"
          :can-display="!mobileLayout"
          filter-label="筛选插件"
          display-label="选择插件展示方式"
          @filter="draft = { ...criteria }"
          @operator="operatorOpen = !operatorOpen"
          @display="displayOpen = true"
        />
      </template>
      <PluginFilters
        v-model:draft="draft"
        :categories="categories"
        :result-count="preview.length"
        :total-count="counts[filter]"
        :disabled="disabled"
        @apply="applyFilters"
      />
      <PluginDetailsDialog
        :item="details"
        :busy="disabled"
        @close="detailsId = undefined"
        @set-enabled="details && setEnabled(details.id, $event)"
        @retry="details && feature.actions.retry(details.id)"
        @manage="manageDetails"
      />
      <AppDialog
        :open="displayOpen"
        title="插件展示方式"
        size="compact"
        @close="displayOpen = false"
      >
        <PluginDisplayOptions :display="display" @select="selectDisplay" />
      </AppDialog>
      <template #operator>
        <PluginOperator
          :open="operatorOpen"
          :suspended="modalOpen || disabled"
          :selected-count="selected.length"
          :visible-count="visible.length"
          :all-selected="controls.areAllVisibleSelected.value"
          :some-selected="controls.areSomeVisibleSelected.value"
          :can-enable="canEnable"
          :can-disable="canDisable"
          @close="operatorOpen = false"
          @toggle-all="controls.toggleAllVisible"
          @enable="setSelectedEnabled(true)"
          @disable="setSelectedEnabled(false)"
          @refresh="feature.actions.refresh()"
        />
      </template>
    </ClassicPageOverlays>
  </section>
</template>
