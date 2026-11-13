<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import BottomSheet from '@any-music/ui/components/BottomSheet.vue'
import type { TagManagementPresentation } from '@any-music/ui/theme'
import { useId, useTemplateRef } from 'vue'

import { useTagManagementFilterPanel } from '../../composables/use-tag-management-filter-panel'
import ClassicFilterFooter from '../library/ClassicFilterFooter.vue'
import CatalogFilterPreview from '../music-sources/CatalogFilterPreview.vue'
import CollectionFilterChoices from '../music-sources/CollectionFilterChoices.vue'
import CollectionFilterSummary from '../music-sources/CollectionFilterSummary.vue'

const props = defineProps<{ editor: TagManagementPresentation }>()
const filterId = useId()
const {
  active,
  detailOpen,
  draft,
  dimensions,
  groups,
  current,
  usageOptions,
  scopeOptions,
  sortOptions,
  platformOptions,
  set,
  edit,
  back,
  finish,
  remove,
  clear,
  leave,
  handleViewAfterLeave,
  focusView,
} = useTagManagementFilterPanel(props, useTemplateRef<HTMLElement>('overview'))
</script>

<template>
  <BottomSheet
    :open="draft !== null"
    title="标签筛选器"
    size="full"
    @close="editor.actions.cancelFilters"
  >
    <section v-if="draft" class="catalog-filters" aria-label="标签筛选器">
      <Transition
        name="catalog-filter-fade"
        mode="out-in"
        @before-leave="leave"
        @after-leave="handleViewAfterLeave"
        @after-enter="focusView"
      >
        <div v-if="!active" key="overview" ref="overview" class="catalog-filters__overview">
          <nav class="catalog-filters__dimensions" aria-label="标签筛选类型">
            <button
              v-for="dimension in dimensions"
              :key="dimension.id"
              class="catalog-filter-dimension"
              type="button"
              :data-filter-dimension="dimension.id"
              @click="edit(dimension.id)"
            >
              <span class="catalog-filter-dimension__icon"
                ><AppIcon :name="dimension.icon" :size="17"
              /></span>
              <span class="catalog-filter-dimension__copy"
                ><strong>{{ dimension.label }}</strong
                ><small v-if="dimension.labels.length"
                  >已筛选 {{ dimension.labels.length }} 项</small
                ></span
              >
              <span v-if="dimension.labels.length" class="catalog-filter-dimension__count">{{
                dimension.labels.length
              }}</span>
              <AppIcon class="catalog-filter-dimension__arrow" name="arrow-right" :size="15" />
            </button>
          </nav>
          <div class="catalog-filters__summary">
            <CollectionFilterSummary
              :groups="groups"
              :result-count="editor.state.filterPreviewCount"
              :total-count="editor.state.allTagOptions.length"
              unit="个标签"
              all-label="全部标签"
              all-description="全部已有标签都会显示"
              @edit="edit"
              @remove="remove"
              @clear="clear"
            />
            <p class="tag-filter-editor__hint">
              已标记{{ editor.state.entityKind === 'playlists' ? '歌单' : '音乐' }}
              {{
                editor.state.entityKind === 'playlists'
                  ? editor.state.taggedPlaylistCount
                  : editor.state.taggedRecords.length
              }}
              {{ editor.state.entityKind === 'playlists' ? '个' : '首' }} · 覆盖平台
              {{ editor.state.platformOptions.filter(({ count }) => count > 0).length }} 个
            </p>
          </div>
        </div>
        <section v-else key="detail" class="catalog-filters__detail">
          <header class="catalog-filters__detail-header">
            <div class="catalog-filters__detail-heading">
              <div>
                <strong>{{ current.label }}</strong
                ><small>{{ current.description }}</small>
              </div>
            </div>
            <CatalogFilterPreview
              :result-count="editor.state.filterPreviewCount"
              :total-count="editor.state.allTagOptions.length"
              unit="个标签"
            />
          </header>
          <div class="catalog-filters__detail-content">
            <div
              class="catalog-filter-editor tag-filter-editor"
              :class="{ 'catalog-filter-editor--search': active === 'searchQuery' }"
            >
              <form
                v-if="active === 'searchQuery'"
                class="catalog-filter-editor__search"
                role="search"
                @submit.prevent="finish"
              >
                <label :for="`${filterId}-search`" class="catalog-filter-editor__label"
                  >标签名称</label
                >
                <span class="catalog-filter-editor__input-control">
                  <input
                    :id="`${filterId}-search`"
                    class="catalog-filter-editor__line-input catalog-filter-editor__search-input"
                    type="search"
                    :value="draft.searchQuery"
                    autocomplete="off"
                    inputmode="search"
                    maxlength="120"
                    placeholder="输入标签名称"
                    aria-label="搜索标签名称"
                    data-editor-focus
                    @input="set('searchQuery', ($event.target as HTMLInputElement).value)"
                  />
                </span>
              </form>
              <CollectionFilterChoices
                v-else-if="active === 'selectedPlatformIds'"
                :model-value="draft.selectedPlatformIds"
                label="关联平台"
                :options="platformOptions"
                :multiple="true"
                :all-option="{ label: '全部关联平台', description: '不限标签关联的平台' }"
                @update:model-value="set('selectedPlatformIds', $event)"
              />
              <CollectionFilterChoices
                v-else-if="active === 'usage'"
                :model-value="draft.usage"
                :label="`关联${editor.state.entityKind === 'playlists' ? '歌单' : '歌曲'}数量`"
                :options="usageOptions"
                :multiple="true"
                :all-option="{
                  label: `全部${editor.state.entityKind === 'playlists' ? '歌单' : '歌曲'}数量`,
                  description: '不限标签关联的数量',
                }"
                @update:model-value="set('usage', $event)"
              />
              <CollectionFilterChoices
                v-else-if="active === 'platformScope'"
                :model-value="draft.platformScope"
                label="平台覆盖范围"
                :options="scopeOptions"
                :multiple="true"
                :all-option="{ label: '全部平台覆盖', description: '不限标签关联的平台数量' }"
                @update:model-value="set('platformScope', $event)"
              />
              <CollectionFilterChoices
                v-else
                :model-value="draft.sortMode"
                label="标签排序方式"
                :options="sortOptions"
                :multiple="true"
                :all-option="{ label: '全部排序方式', description: '使用默认的最近维护排序' }"
                @update:model-value="set('sortMode', $event)"
              />
            </div>
          </div>
          <footer class="catalog-filters__detail-footer">
            <span
              >匹配 {{ editor.state.filterPreviewCount }} /
              {{ editor.state.allTagOptions.length }} 个标签</span
            >
            <div class="catalog-filters__detail-actions">
              <button
                class="catalog-filters__footer-back"
                type="button"
                aria-label="返回筛选概览"
                @click="back"
              >
                <AppIcon name="arrow-left" :size="16" />返回</button
              ><button class="catalog-filters__footer-confirm" type="button" @click="finish">
                <AppIcon name="check" :size="16" />确定
              </button>
            </div>
          </footer>
        </section>
      </Transition>
    </section>
    <template v-if="!detailOpen" #footer
      ><ClassicFilterFooter
        :summary="`匹配 ${editor.state.filterPreviewCount} / ${editor.state.allTagOptions.length} 个标签`"
        @cancel="editor.actions.cancelFilters"
        @apply="editor.actions.applyFilters"
    /></template>
  </BottomSheet>
</template>

<style scoped lang="scss">
@use '../../styles/collection-filters';
@use '../../styles/catalog-filter-editor';
@include collection-filters.panel;
@include catalog-filter-editor.editor;

.tag-filter-editor {
  inline-size: 100%;
  box-sizing: border-box;
}
.tag-filter-editor__hint {
  margin: var(--am-space-3) 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  line-height: 1.7;
}
</style>
