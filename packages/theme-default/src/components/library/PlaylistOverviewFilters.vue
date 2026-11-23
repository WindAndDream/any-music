<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { useTemplateRef } from 'vue'

import { usePlaylistOverviewFilters } from '../../composables/use-playlist-overview-filters'
import type { PlaylistOverviewFilterProps } from '../../composables/use-playlist-overview-filters'
import CatalogFilterDimensions from '../music-sources/CatalogFilterDimensions.vue'
import CatalogFilterHelp from '../music-sources/CatalogFilterHelp.vue'
import CollectionFilterSheet from '../music-sources/CollectionFilterSheet.vue'
import CollectionFilterSummary from '../music-sources/CollectionFilterSummary.vue'
import ClassicFilterFooter from './ClassicFilterFooter.vue'
import PlaylistOverviewFilterEditor from './PlaylistOverviewFilterEditor.vue'

const props = defineProps<PlaylistOverviewFilterProps>()
const emit = defineEmits<{
  'update:draft': [filters: PlaylistOverviewFilterProps['draft']]
  apply: []
}>()
const {
  editor,
  tagsEnabled,
  tagStats,
  visibleTagStats,
  coverOptions,
  active,
  local,
  dimensions,
  groups,
  current,
  previewCount,
  edit,
  back,
  applyDimension,
  remove,
  focusView,
  leave,
} = usePlaylistOverviewFilters(
  props,
  (value) => emit('update:draft', value),
  useTemplateRef<HTMLElement>('overview'),
)
</script>

<template>
  <CollectionFilterSheet
    :open="draft !== null"
    title="歌单筛选器"
    @close="emit('update:draft', null)"
  >
    <section
      v-if="draft"
      class="catalog-filters"
      aria-label="歌单筛选器"
      :inert="disabled ? true : undefined"
    >
      <Transition
        name="catalog-filter-fade"
        mode="out-in"
        @before-leave="leave"
        @after-enter="focusView"
      >
        <div v-if="!active" key="overview" ref="overview" class="catalog-filters__overview">
          <CatalogFilterDimensions label="筛选类型">
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
              <strong class="catalog-filter-dimension__label">{{ dimension.label }}</strong>
              <span v-if="dimension.labels.length" class="catalog-filter-dimension__count">{{
                dimension.labels.length
              }}</span>
              <AppIcon class="catalog-filter-dimension__arrow" name="arrow-right" :size="15" />
            </button>
          </CatalogFilterDimensions>
          <div class="catalog-filters__summary">
            <CollectionFilterSummary :groups="groups" @edit="edit" @remove="remove" />
          </div>
        </div>
        <section v-else key="detail" class="catalog-filters__detail">
          <header class="catalog-filters__detail-header">
            <div class="catalog-filters__detail-heading">
              <strong>{{ current.label }}</strong>
              <CatalogFilterHelp :label="current.label" :description="current.description" />
            </div>
          </header>
          <div class="catalog-filters__detail-content">
            <PlaylistOverviewFilterEditor
              v-model:filters="local"
              v-model:tag-query="editor.tagQuery.value"
              v-model:minimum-count="editor.minimumCount.value"
              v-model:maximum-count="editor.maximumCount.value"
              :dimension="active"
              :editing-index="editor.editingIndex.value"
              :count-error="editor.countError.value"
              :can-add-range="editor.canAddRange.value"
              :tag-stats="tagStats"
              :visible-tag-stats="visibleTagStats"
              :tags-enabled="tagsEnabled"
              :cover-options="coverOptions"
              @confirm="applyDimension"
              @add-range="editor.addRange"
              @edit-range="editor.editRange"
              @remove-range="editor.removeRange"
            />
          </div>
          <footer class="catalog-filters__detail-footer">
            <span
              >匹配 <strong>{{ previewCount }} / {{ totalCount }} 个歌单</strong></span
            >
            <div class="catalog-filters__detail-actions">
              <button
                class="catalog-filters__footer-back"
                type="button"
                aria-label="返回筛选概览"
                @click="back"
              >
                <AppIcon name="arrow-left" :size="16" />返回
              </button>
              <button class="catalog-filters__footer-confirm" type="button" @click="applyDimension">
                <AppIcon name="check" :size="16" />确定
              </button>
            </div>
          </footer>
        </section>
      </Transition>
    </section>
    <template v-if="!active" #footer>
      <ClassicFilterFooter
        :result-count="resultCount"
        :total-count="totalCount"
        unit="个歌单"
        :disabled="disabled"
        @cancel="emit('update:draft', null)"
        @apply="emit('apply')"
      />
    </template>
  </CollectionFilterSheet>
</template>

<style scoped lang="scss">
@use '../../styles/collection-filters';
@include collection-filters.panel;
</style>
