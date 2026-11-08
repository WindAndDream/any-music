<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import BottomSheet from '@any-music/ui/components/BottomSheet.vue'
import { useId, useTemplateRef } from 'vue'

import type { PluginFilterState } from '../../composables/use-classic-plugins'
import { usePluginFilterPanel } from '../../composables/use-plugin-filter-panel'
import ClassicFilterFooter from '../library/ClassicFilterFooter.vue'
import CatalogFilterPreview from '../music-sources/CatalogFilterPreview.vue'
import CollectionFilterChoices from '../music-sources/CollectionFilterChoices.vue'
import CollectionFilterSummary from '../music-sources/CollectionFilterSummary.vue'

const props = defineProps<{
  categories: readonly string[]
  resultCount: number
  totalCount: number
  disabled: boolean
}>()
const draft = defineModel<PluginFilterState | null>('draft', { required: true })
defineEmits<{ apply: [] }>()
const filterId = useId()
const {
  active,
  detailOpen,
  dimensions,
  groups,
  current,
  categoryOptions,
  statusOptions,
  developmentStatusOptions,
  set,
  edit,
  back,
  finish,
  remove,
  clear,
  leave,
  afterLeave,
  focusView,
} = usePluginFilterPanel(draft, () => props.categories, useTemplateRef<HTMLElement>('overview'))
</script>

<template>
  <BottomSheet :open="draft !== null" title="插件筛选器" size="full" @close="draft = null">
    <section
      v-if="draft"
      class="catalog-filters"
      aria-label="插件筛选器"
      :inert="disabled ? true : undefined"
    >
      <Transition
        name="catalog-filter-fade"
        mode="out-in"
        @before-leave="leave"
        @after-leave="afterLeave"
        @enter="focusView"
        @after-enter="focusView"
      >
        <div v-if="!active" key="overview" ref="overview" class="catalog-filters__overview">
          <nav class="catalog-filters__dimensions" aria-label="插件筛选类型">
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
              :result-count="resultCount"
              :total-count="totalCount"
              unit="个插件"
              all-label="全部插件"
              all-description="当前分类的全部插件都会显示"
              @edit="edit"
              @remove="remove"
              @clear="clear"
            />
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
              :result-count="resultCount"
              :total-count="totalCount"
              unit="个插件"
            />
          </header>
          <div class="catalog-filters__detail-content">
            <div
              class="catalog-filter-editor plugin-filter-editor"
              :class="{ 'catalog-filter-editor--search': active === 'keyword' }"
            >
              <form
                v-if="active === 'keyword'"
                class="catalog-filter-editor__search"
                role="search"
                @submit.prevent="finish"
              >
                <label :for="`${filterId}-keyword`" class="catalog-filter-editor__label"
                  >插件名称、描述或发布者</label
                >
                <span class="catalog-filter-editor__input-control"
                  ><input
                    :id="`${filterId}-keyword`"
                    :value="draft.keyword"
                    class="catalog-filter-editor__line-input catalog-filter-editor__search-input"
                    type="search"
                    autocomplete="off"
                    inputmode="search"
                    maxlength="120"
                    aria-label="筛选插件关键词"
                    placeholder="输入插件名称、描述或发布者"
                    data-editor-focus
                    @input="set('keyword', ($event.target as HTMLInputElement).value)"
                /></span>
              </form>
              <CollectionFilterChoices
                v-else-if="active === 'category'"
                :model-value="draft.category"
                multiple
                label="筛选插件类型"
                :all-option="{ label: '全部类型', description: '不限插件类型' }"
                :options="categoryOptions"
                @update:model-value="set('category', $event)"
              />
              <CollectionFilterChoices
                v-else-if="active === 'status'"
                :model-value="draft.status"
                multiple
                label="筛选插件状态"
                :all-option="{ label: '全部状态', description: '显示所有状态的插件' }"
                :options="statusOptions"
                @update:model-value="set('status', $event)"
              />
              <CollectionFilterChoices
                v-else
                :model-value="draft.developmentStatus"
                multiple
                label="筛选开发者状态"
                :all-option="{ label: '全部开发者状态', description: '不限开发者维护状态' }"
                :options="developmentStatusOptions"
                @update:model-value="set('developmentStatus', $event)"
              />
            </div>
          </div>
          <footer class="catalog-filters__detail-footer">
            <span>匹配 {{ resultCount }} / {{ totalCount }} 个插件</span>
            <div class="catalog-filters__detail-actions">
              <button
                class="catalog-filters__footer-back"
                type="button"
                aria-label="返回筛选概览"
                @click="back"
              >
                <AppIcon name="arrow-left" :size="16" />返回
              </button>
              <button class="catalog-filters__footer-confirm" type="button" @click="finish">
                <AppIcon name="check" :size="16" />确定
              </button>
            </div>
          </footer>
        </section>
      </Transition>
    </section>
    <template v-if="!detailOpen" #footer>
      <ClassicFilterFooter
        :summary="`匹配 ${resultCount} / ${totalCount} 个插件`"
        :disabled="disabled"
        @cancel="draft = null"
        @apply="$emit('apply')"
      />
    </template>
  </BottomSheet>
</template>

<style scoped lang="scss">
@use '../../styles/collection-filters';
@use '../../styles/catalog-filter-editor';
@include collection-filters.panel;
@include catalog-filter-editor.editor;

.plugin-filter-editor {
  box-sizing: border-box;
  inline-size: 100%;
}
</style>
