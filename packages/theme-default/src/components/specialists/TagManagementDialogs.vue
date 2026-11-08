<script setup lang="ts">
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import type { TagDisplayMode, TagManagementPresentation } from '@any-music/ui/theme'
import { computed, shallowRef } from 'vue'

import ReadonlyPlaylistCollection from '../library/ReadonlyPlaylistCollection.vue'
import ReadonlyTrackCollection from '../library/ReadonlyTrackCollection.vue'
import TagManagementFilters from './TagManagementFilters.vue'

const props = defineProps<{
  editor: TagManagementPresentation
  displayOpen: boolean
  mobileLayout?: boolean
}>()
const emit = defineEmits<{ closeDisplay: [] }>()
const detailModalOpen = shallowRef(false)
const platformNames = computed(
  () => new Map(props.editor.state.platformOptions.map(({ id, name }) => [id, name])),
)
const modes = [
  {
    id: 'fill',
    label: '默认撑满',
    description: '标签按名称长度排列，最多一行；行尾标签占用剩余宽度，超出文字省略。',
  },
  { id: 'rows', label: '单独一行', description: '每个标签独占一行，方便逐个查看和整理。' },
] as const
function selectDisplay(mode: TagDisplayMode): void {
  props.editor.actions.setDisplayMode(mode)
  emit('closeDisplay')
}
function updateTarget(event: Event): void {
  props.editor.actions.setMergeTarget((event.target as HTMLInputElement).value)
}
</script>

<template>
  <AppDialog
    :open="editor.state.createOpen"
    title="创建标签"
    size="compact"
    initial-focus-selector="[data-tag-create-input]"
    @close="editor.actions.cancelCreate"
  >
    <component :is="editor.controls.Create" :editor="editor" />
  </AppDialog>
  <AppDialog :open="displayOpen" title="标签展示方式" size="compact" @close="emit('closeDisplay')"
    ><div class="tag-management__display-options" role="group" aria-label="标签排列方式">
      <button
        v-for="mode in modes"
        :key="mode.id"
        type="button"
        :aria-pressed="editor.state.displayMode === mode.id"
        @click="selectDisplay(mode.id)"
      >
        <span
          class="tag-management__preview"
          :class="{ 'tag-management__preview--rows': mode.id === 'rows' }"
          aria-hidden="true"
          ><i></i><i></i><i></i></span
        ><span
          ><strong>{{ mode.label }}</strong
          ><small>{{ mode.description }}</small></span
        >
      </button>
    </div></AppDialog
  >
  <TagManagementFilters :editor="editor" />
  <component :is="editor.controls.Details" :editor="editor" :suspended="detailModalOpen">
    <template #tracks
      ><ReadonlyTrackCollection
        :records="editor.state.detailRecords"
        :selected-ids="editor.state.detailSelectedIds"
        :disabled="editor.state.confirming"
        :default-display-preferences="editor.state.defaultTrackDisplayPreferences"
        :platform-names="platformNames"
        :mobile-layout="mobileLayout"
        @modal-open-change="detailModalOpen = $event"
        @select="editor.actions.toggleDetailItem"
        @toggle-all="editor.actions.toggleAllDetailItems"
    /></template>
    <template #playlists
      ><ReadonlyPlaylistCollection
        :records="editor.state.detailPlaylists"
        :selected-ids="editor.state.detailSelectedIds"
        :disabled="editor.state.confirming"
        :mobile-layout="mobileLayout"
        @modal-open-change="detailModalOpen = $event"
        @select="editor.actions.toggleDetailItem"
        @toggle-all="editor.actions.toggleAllDetailItems"
    /></template>
  </component>
  <AppDialog
    :open="editor.state.mergeOpen"
    :suspended="editor.state.confirming"
    :title="`合并标签 ·${editor.state.selectedTags.length}个标签`"
    description="合并会更新所有关联歌曲和歌单，重复标签自动去重。"
    size="compact"
    initial-focus-selector="[data-tag-merge-input]"
    @close="editor.actions.cancelMerge"
    ><form class="tag-management__merge" @submit.prevent="editor.actions.mergeSelectedTags">
      <label class="tag-management__merge-field"
        >合并后的标签名称<input
          :value="editor.state.mergeTarget"
          type="text"
          maxlength="32"
          autocomplete="off"
          aria-label="合并后的标签名称"
          data-tag-merge-input
          @input="updateTarget"
      /></label>
      <hr class="tag-management__merge-divider" />
      <button
        type="submit"
        :disabled="
          editor.state.selectedTags.length < 2 ||
          !editor.state.mergeTarget.trim() ||
          editor.state.confirming
        "
      >
        确认合并
      </button>
      <p v-if="editor.state.errorMessage" class="tag-management__error" role="alert">
        {{ editor.state.errorMessage }}
      </p>
    </form></AppDialog
  >
</template>
