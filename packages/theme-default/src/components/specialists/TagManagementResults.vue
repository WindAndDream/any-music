<script setup lang="ts">
import { useIntrinsicWrap } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { TagManagementPresentation } from '@any-music/ui/theme'
import { useTemplateRef } from 'vue'

import TagManagementTag from './TagManagementTag.vue'

const props = defineProps<{ editor: TagManagementPresentation }>()
const tagList = useTemplateRef<HTMLElement>('tagList')
useIntrinsicWrap({
  container: tagList,
  enabled: () => props.editor.state.displayMode === 'fill',
  content: () => [props.editor.state.tagOptions, props.editor.state.operatorOpen],
})
</script>

<template>
  <div class="tag-management__results" aria-label="标签列表">
    <div v-if="!editor.state.allTagOptions.length" class="tag-management__empty">
      <AppIcon name="tags" :size="36" />
      <h3>从第一个标签开始</h3>
      <p>
        点击右上角「创建标签」，或在{{
          editor.state.entityKind === 'playlists' ? '歌单' : '歌曲'
        }}的「操作 → 标签管理」中添加标签。
      </p>
    </div>
    <div v-else-if="!editor.state.tagOptions.length" class="tag-management__empty">
      <AppIcon name="filter" :size="32" />
      <h3>没有匹配的标签</h3>
      <p>
        试试调整名称、关联平台或{{
          editor.state.entityKind === 'playlists' ? '歌单' : '歌曲'
        }}数量。
      </p>
      <button type="button" @click="editor.actions.resetFilters">重置筛选</button>
    </div>
    <div
      v-else
      ref="tagList"
      class="tag-management__tag-list"
      :class="{ 'tag-management__tag-list--rows': editor.state.displayMode === 'rows' }"
      :role="editor.state.operatorOpen ? 'group' : undefined"
      :aria-label="editor.state.operatorOpen ? '选择要操作的标签' : undefined"
    >
      <TagManagementTag
        v-for="tag in editor.state.tagOptions"
        :key="tag.key"
        :tag="tag"
        :playlist="editor.state.entityKind === 'playlists'"
        :selectable="editor.state.operatorOpen"
        :selected="editor.state.selectedTagKeys.has(tag.key)"
        @activate="editor.actions.activateTag"
      />
    </div>
  </div>
</template>
