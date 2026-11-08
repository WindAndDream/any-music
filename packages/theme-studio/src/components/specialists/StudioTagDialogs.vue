<script setup lang="ts">
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import type { TagDisplayMode, TagManagementPresentation } from '@any-music/ui/theme'
import { computed, shallowRef } from 'vue'

import StudioReadonlyPlaylists from '../library/StudioReadonlyPlaylists.vue'
import StudioReadonlyTracks from '../library/StudioReadonlyTracks.vue'

const props = defineProps<{ editor: TagManagementPresentation; displayOpen: boolean }>()
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
  { id: 'rows', label: '单独一行', description: '每个标签独占一行。' },
] as const
function selectMode(mode: TagDisplayMode): void {
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
    ><div class="studio-tag-desk__display-options" role="group" aria-label="标签排列方式">
      <button
        v-for="mode in modes"
        :key="mode.id"
        type="button"
        :aria-pressed="editor.state.displayMode === mode.id"
        @click="selectMode(mode.id)"
      >
        <strong>{{ mode.label }}</strong
        ><small>{{ mode.description }}</small>
      </button>
    </div></AppDialog
  >
  <AppDialog
    :open="editor.state.filterDraft !== null"
    title="标签筛选器"
    @close="editor.actions.cancelFilters"
    ><component
      v-if="editor.state.filterDraft"
      :is="editor.controls.Filter"
      :model-value="editor.state.filterDraft"
      :platform-options="editor.state.platformOptions"
      :tagged-track-count="editor.state.taggedRecords.length"
      :entity-kind="editor.state.entityKind"
      :tagged-playlist-count="editor.state.taggedPlaylistCount"
      :tag-count="editor.state.allTagOptions.length"
      @update:model-value="editor.actions.setFilterDraft"
    /><template #footer
      ><div class="studio-actions studio-tag-desk__filter-footer">
        <span role="status"
          >匹配 {{ editor.state.filterPreviewCount }} /
          {{ editor.state.allTagOptions.length }} 个标签</span
        ><button type="button" @click="editor.actions.cancelFilters">取消</button
        ><button type="button" @click="editor.actions.applyFilters">应用筛选</button>
      </div></template
    ></AppDialog
  >
  <component :is="editor.controls.Details" :editor="editor" :suspended="detailModalOpen">
    <template #tracks
      ><StudioReadonlyTracks
        :records="editor.state.detailRecords"
        :selected-ids="editor.state.detailSelectedIds"
        :disabled="editor.state.confirming"
        :default-display-preferences="editor.state.defaultTrackDisplayPreferences"
        :platform-names="platformNames"
        @modal-open-change="detailModalOpen = $event"
        @select="editor.actions.toggleDetailItem"
        @toggle-all="editor.actions.toggleAllDetailItems"
    /></template>
    <template #playlists
      ><StudioReadonlyPlaylists
        :records="editor.state.detailPlaylists"
        :selected-ids="editor.state.detailSelectedIds"
        :disabled="editor.state.confirming"
        @modal-open-change="detailModalOpen = $event"
        @select="editor.actions.toggleDetailItem"
        @toggle-all="editor.actions.toggleAllDetailItems"
    /></template>
  </component>
  <AppDialog
    :open="editor.state.mergeOpen"
    :suspended="editor.state.confirming"
    title="合并标签"
    size="compact"
    @close="editor.actions.cancelMerge"
    ><form class="studio-tag-desk__merge" @submit.prevent="editor.actions.mergeSelectedTags">
      <p>
        已选
        {{ editor.state.selectedTags.length }}
        个标签。操作会更新全部关联歌曲和歌单，重复标签自动去重。
      </p>
      <label
        >合并后的标签名称<input
          :value="editor.state.mergeTarget"
          maxlength="32"
          aria-label="合并后的标签名称"
          @input="updateTarget"
      /></label>
      <p>可以输入已有标签名称，也可以使用新名称。</p>
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
      <p v-if="editor.state.errorMessage" class="studio-tag-desk__error" role="alert">
        {{ editor.state.errorMessage }}
      </p>
    </form></AppDialog
  >
</template>
