<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { TagManagementPresentation } from '@any-music/ui/theme'

import CatalogOperatorPanel from '../music-sources/CatalogOperatorPanel.vue'

defineProps<{ editor: TagManagementPresentation }>()
</script>

<template>
  <CatalogOperatorPanel
    class="tag-management-operator"
    :selected-count="editor.state.selectedTags.length"
    :visible-count="editor.state.tagOptions.length"
    :all-selected="
      editor.state.tagOptions.length > 0 &&
      editor.state.selectedTags.length === editor.state.tagOptions.length
    "
    :some-selected="
      editor.state.selectedTags.length > 0 &&
      editor.state.selectedTags.length < editor.state.tagOptions.length
    "
    :disabled="editor.state.confirming"
    select-all-label="全选当前匹配标签"
    count-unit="个"
    @toggle-all="editor.actions.toggleAllTags"
  >
    <button
      type="button"
      :disabled="editor.state.selectedTags.length !== 1 || editor.state.confirming"
      @click="editor.actions.editSelectedTag"
    >
      <AppIcon name="edit" :size="18" />重命名
    </button>
    <button
      type="button"
      :disabled="editor.state.selectedTags.length < 2 || editor.state.confirming"
      @click="editor.actions.beginMerge"
    >
      <AppIcon name="tags" :size="18" />合并标签
    </button>
    <button
      type="button"
      :disabled="!editor.state.selectedTags.length || editor.state.confirming"
      class="catalog-actions__remove"
      @click="editor.actions.deleteSelectedTags"
    >
      <AppIcon name="trash" :size="18" />删除标签
    </button>
  </CatalogOperatorPanel>
</template>

<style scoped>
.tag-management-operator :deep(.catalog-operator-actions__content button),
.tag-management-operator :deep(.catalog-actions__selection) {
  font-weight: 700;
}
</style>
