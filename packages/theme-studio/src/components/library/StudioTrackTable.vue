<script setup lang="ts">
import type { UiThemeTrackListActions, UiThemeTrackListState } from '@any-music/ui/theme'
import type { DeepReadonly } from 'vue'

import StudioTrackRow from '../catalog/StudioTrackRow.vue'
import StudioStyledTrack from './StudioStyledTrack.vue'
import StudioTrackCollectionLayout from './StudioTrackCollectionLayout.vue'

const props = defineProps<{
  state: DeepReadonly<UiThemeTrackListState>
  actions: UiThemeTrackListActions
  disabled?: boolean
  reorder?: (ids: readonly string[]) => void
  continuityRegion?: string
  virtualized?: boolean
}>()
defineSlots<{ details?: (context: { trackId: string }) => unknown }>()
function select(id: string) {
  if (props.disabled) return
  const ids = new Set(props.state.selectedTrackIds)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  props.actions.select([...ids])
}
function move(id: string, offset: -1 | 1) {
  if (props.disabled) return
  const ids = props.state.tracks.map((track) => track.id)
  const index = ids.indexOf(id),
    next = index + offset
  if (index < 0 || next < 0 || next >= ids.length) return
  ;[ids[index], ids[next]] = [ids[next]!, ids[index]!]
  props.reorder?.(ids)
}
</script>

<template>
  <StudioTrackCollectionLayout
    :state="state"
    :disabled="disabled"
    :virtualized="virtualized"
    :continuity-region="continuityRegion"
    :row-count="reorder || $slots.details ? 2 : 1"
  >
    <template #card="{ track }">
      <div class="studio-minimal-cell" :data-am-continuity-item="track.id">
        <StudioStyledTrack
          :item-style="state.itemStyle"
          :reorderable="Boolean(reorder)"
          @shift="move(track.id, $event)"
          :track="track"
          :custom-tags="state.customTagsByTrackId.get(track.id)"
          :title="state.customNamesByTrackId.get(track.id) ?? track.title"
          :invalid="disabled || state.invalidTrackIds.includes(track.id)"
          :selected="state.selectedTrackIds.includes(track.id)"
          selectable
          @play="
            !disabled &&
            actions.play(
              track.id,
              state.tracks.map((item) => item.id),
            )
          "
          @select="select(track.id)"
          @actions="!disabled && actions.showTrackActions(track.id)"
        />
        <slot name="details" :track-id="track.id" />
      </div>
    </template>
    <template #head>
      <tr aria-rowindex="1">
        <th scope="col">选择</th>
        <th scope="col">音乐 / 作者</th>
        <th scope="col">时长</th>
        <th scope="col">操作</th>
      </tr>
    </template>
    <template #rows="{ track, index, rowIndex }">
      <StudioTrackRow
        :data-am-continuity-item="track.id"
        :aria-rowindex="rowIndex"
        :track="track"
        :index="index"
        :title="state.customNamesByTrackId.get(track.id) ?? track.title"
        :selected="state.selectedTrackIds.includes(track.id)"
        :invalid="state.invalidTrackIds.includes(track.id) || Boolean(disabled)"
        :favorite="state.favoriteTrackIds.includes(track.id)"
        :queued="state.queuedTrackIds.includes(track.id)"
        queue-action="add"
        :current="state.currentTrackId === track.id"
        :download-busy="Boolean(state.downloadBusy)"
        @select="select(track.id)"
        @play="
          !disabled &&
          actions.play(
            track.id,
            state.tracks.map((item) => item.id),
          )
        "
        @favorite="!disabled && actions.toggleFavorite(track.id)"
        @queue="!disabled && actions.enqueue([track.id])"
        @download="!disabled && actions.download([track.id])"
        @actions="!disabled && actions.showTrackActions(track.id)"
      />
      <tr
        v-if="reorder || $slots.details"
        :aria-rowindex="rowIndex === undefined ? undefined : rowIndex + 1"
      >
        <td colspan="4">
          <div v-if="reorder" class="studio-actions">
            <button
              type="button"
              :aria-label="`上移《${track.title}》`"
              :disabled="disabled || index === 0"
              @click="move(track.id, -1)"
            >
              上移
            </button>
            <button
              type="button"
              :aria-label="`下移《${track.title}》`"
              :disabled="disabled || index === state.tracks.length - 1"
              @click="move(track.id, 1)"
            >
              下移
            </button>
          </div>
          <slot name="details" :track-id="track.id" />
        </td>
      </tr>
    </template>
  </StudioTrackCollectionLayout>
</template>

<style scoped>
.studio-minimal-cell {
  display: grid;
  min-inline-size: 0;
  container: am-track-card / inline-size;
}
</style>
