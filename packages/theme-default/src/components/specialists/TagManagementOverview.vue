<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { TagManagementPresentation } from '@any-music/ui/theme'

import ClassicCollectionSurface from '../library/ClassicCollectionSurface.vue'
import TagEntitySwitch from './TagEntitySwitch.vue'

defineProps<{ editor: TagManagementPresentation; mobileLayout?: boolean }>()
defineSlots<{ default(): unknown }>()
</script>

<template>
  <ClassicCollectionSurface
    title="标签管理"
    :intro="
      editor.state.entityKind === 'playlists'
        ? '创建和整理标签，让歌单归类更轻松。'
        : '创建和整理标签，让音乐归类更轻松。'
    "
    :total-count="editor.state.allTagOptions.length"
    count-unit="个"
    :show-count="!mobileLayout"
    :mobile-layout="Boolean(mobileLayout)"
    :detail="false"
    :empty="!editor.state.tagOptions.length"
  >
    <template #controls>
      <div class="tag-management__actions">
        <TagEntitySwitch :kind="editor.state.entityKind" @change="editor.actions.setEntityKind" />
        <button
          class="tag-management__create"
          type="button"
          aria-haspopup="dialog"
          @click="editor.actions.beginCreate"
        >
          <AppIcon name="plus" :size="16" />创建标签
        </button>
      </div>
    </template>
    <slot />
  </ClassicCollectionSurface>
</template>
