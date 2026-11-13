<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { TagManagementPresentation } from '@any-music/ui/theme'
import { computed, shallowRef } from 'vue'

import StudioPageOverlays from '../overlays/StudioPageOverlays.vue'
import StudioTagDialogs from './StudioTagDialogs.vue'
import StudioTagResults from './StudioTagResults.vue'

const props = defineProps<{ editor: TagManagementPresentation }>()
const state = computed(() => props.editor.state)
const displayOpen = shallowRef(false)
const modalOpen = computed(
  () =>
    displayOpen.value ||
    state.value.filterDraft !== null ||
    state.value.detailTag !== null ||
    state.value.mergeOpen ||
    state.value.createOpen,
)
</script>

<template>
  <section class="studio-tag-desk" aria-label="标签管理">
    <header class="studio-tag-desk__heading">
      <div class="studio-tag-desk__intro">
        <h2>标签管理</h2>
        <p>
          创建和整理标签，让{{ state.entityKind === 'playlists' ? '歌单' : '音乐' }}归类更轻松。
        </p>
      </div>
      <div class="studio-tag-desk__heading-actions">
        <small :aria-label="`共 ${state.allTagOptions.length} 个标签`"
          ><strong>{{ state.allTagOptions.length }}</strong> 个标签</small
        >
        <button type="button" aria-haspopup="dialog" @click="editor.actions.beginCreate">
          <AppIcon name="plus" :size="18" />创建标签
        </button>
      </div>
    </header>
    <div class="studio-actions" role="group" aria-label="标签类型">
      <button
        type="button"
        :aria-pressed="state.entityKind === 'tracks'"
        @click="editor.actions.setEntityKind('tracks')"
      >
        <AppIcon name="music" :size="16" />音乐标签
      </button>
      <button
        type="button"
        :aria-pressed="state.entityKind === 'playlists'"
        @click="editor.actions.setEntityKind('playlists')"
      >
        <AppIcon name="playlist" :size="16" />歌单标签
      </button>
    </div>
    <div v-if="state.hasFilters" class="studio-tag-desk__criteria" role="status">
      <span>匹配 {{ state.tagOptions.length }} / {{ state.allTagOptions.length }} 个标签</span
      ><button type="button" @click="editor.actions.resetFilters">清除筛选</button>
    </div>
    <p
      v-if="state.errorMessage && !state.detailTag && !state.mergeOpen"
      class="studio-tag-desk__error"
      role="alert"
    >
      {{ state.errorMessage }}
    </p>
    <StudioTagResults :editor="editor" />
    <div class="studio-actions studio-tag-desk__toolbar">
      <span>共 {{ state.tagOptions.length }}</span>
      <button
        type="button"
        aria-label="标签展示方式"
        aria-haspopup="dialog"
        @click="displayOpen = true"
      >
        <AppIcon name="list" :size="16" />展示方式</button
      ><button type="button" aria-haspopup="dialog" @click="editor.actions.beginFilters">
        <AppIcon name="filter" :size="16" />筛选器{{ state.hasFilters ? ' ·' : '' }}</button
      ><button
        type="button"
        :aria-expanded="state.operatorOpen"
        @click="editor.actions.setOperatorOpen(!state.operatorOpen)"
      >
        <AppIcon name="settings" :size="16" />操作器
      </button>
    </div>
    <aside v-if="state.operatorOpen" class="studio-tag-desk__operator" aria-label="标签操作器">
      <div class="studio-actions">
        <button type="button" @click="editor.actions.setOperatorOpen(false)">关闭操作器</button
        ><label
          ><input
            type="checkbox"
            :checked="
              state.tagOptions.length > 0 && state.selectedTags.length === state.tagOptions.length
            "
            :indeterminate="
              state.selectedTags.length > 0 && state.selectedTags.length < state.tagOptions.length
            "
            :disabled="!state.tagOptions.length || state.confirming"
            aria-label="全选当前匹配标签"
            @change="editor.actions.toggleAllTags"
          />全选 · 已选 {{ state.selectedTags.length }} 个标签</label
        >
      </div>
      <div class="studio-actions">
        <button
          type="button"
          :disabled="state.selectedTags.length !== 1 || state.confirming"
          @click="editor.actions.editSelectedTag"
        >
          重命名</button
        ><button
          type="button"
          :disabled="state.selectedTags.length < 2 || state.confirming"
          @click="editor.actions.beginMerge"
        >
          合并标签</button
        ><button
          type="button"
          :disabled="!state.selectedTags.length || state.confirming"
          @click="editor.actions.deleteSelectedTags"
        >
          删除标签
        </button>
      </div>
    </aside>
    <StudioPageOverlays :open="modalOpen"
      ><StudioTagDialogs
        :editor="editor"
        :display-open="displayOpen"
        @close-display="displayOpen = false"
    /></StudioPageOverlays>
  </section>
</template>
