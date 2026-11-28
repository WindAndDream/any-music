<script setup lang="ts">
import { useIntrinsicWrap } from '@any-music/ui'
import MusicListEmptyState from '@any-music/ui/components/music-sources/MusicListEmptyState.vue'
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
  <div
    class="tag-management__results"
    :class="{ 'tag-management__results--empty': !editor.state.tagOptions.length }"
    aria-label="标签列表"
  >
    <MusicListEmptyState
      v-if="!editor.state.allTagOptions.length"
      icon="tags"
      title="从第一个标签开始"
    >
      点击右上角「创建」，或在{{
        editor.state.entityKind === 'playlists' ? '歌单' : '歌曲'
      }}的「操作 → 标签管理」中添加标签。
    </MusicListEmptyState>
    <MusicListEmptyState
      v-else-if="!editor.state.tagOptions.length"
      icon="filter"
      title="没有匹配的标签"
    >
      试试调整名称、关联平台或{{ editor.state.entityKind === 'playlists' ? '歌单' : '歌曲' }}数量。
      <template #actions>
        <button
          class="tag-management__reset-filters"
          type="button"
          @click="editor.actions.resetFilters"
        >
          重置筛选
        </button>
      </template>
    </MusicListEmptyState>
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
