<script setup lang="ts">
import { useIntrinsicWrap } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { TagManagementPresentation } from '@any-music/ui/theme'
import { useTemplateRef } from 'vue'

const props = defineProps<{ editor: TagManagementPresentation }>()
const tagList = useTemplateRef<HTMLElement>('tagList')
useIntrinsicWrap({
  container: tagList,
  enabled: () => props.editor.state.displayMode === 'fill',
  content: () => [props.editor.state.tagOptions, props.editor.state.operatorOpen],
})
</script>

<template>
  <p v-if="!editor.state.allTagOptions.length" class="studio-tag-desk__empty">
    点击右上角「创建标签」，或在{{
      editor.state.entityKind === 'playlists' ? '歌单' : '歌曲'
    }}的「操作 → 标签管理」中添加第一个标签。
  </p>
  <div v-else-if="!editor.state.tagOptions.length" class="studio-tag-desk__empty">
    <h3>没有匹配的标签</h3>
    <p>
      试试调整名称、平台或关联{{ editor.state.entityKind === 'playlists' ? '歌单' : '歌曲' }}数量。
    </p>
    <button type="button" @click="editor.actions.resetFilters">重置筛选</button>
  </div>
  <div
    v-else
    ref="tagList"
    class="studio-tag-desk__tags"
    :class="{ 'studio-tag-desk__tags--rows': editor.state.displayMode === 'rows' }"
    :role="editor.state.operatorOpen ? 'group' : undefined"
    :aria-label="editor.state.operatorOpen ? '选择要操作的标签' : '标签列表'"
  >
    <component
      v-for="tag in editor.state.tagOptions"
      :key="tag.key"
      :is="editor.state.operatorOpen ? 'label' : 'button'"
      class="studio-tag-desk__tag"
      :class="{ 'studio-tag-desk__tag--selected': editor.state.selectedTagKeys.has(tag.key) }"
      :type="editor.state.operatorOpen ? undefined : 'button'"
      :title="tag.name"
      :aria-label="editor.state.operatorOpen ? undefined : `查看标签 ${tag.name}`"
      :aria-haspopup="editor.state.operatorOpen ? undefined : 'dialog'"
      @click="!editor.state.operatorOpen && editor.actions.activateTag(tag.key)"
    >
      <input
        v-if="editor.state.operatorOpen"
        type="checkbox"
        :checked="editor.state.selectedTagKeys.has(tag.key)"
        :aria-label="`选择标签 ${tag.name}`"
        @change="editor.actions.activateTag(tag.key)"
      /><AppIcon v-else name="tag" :size="18" /><strong>{{ tag.name }}</strong
      ><small>{{ tag.count }} {{ editor.state.entityKind === 'playlists' ? '个' : '首' }}</small>
    </component>
  </div>
</template>
