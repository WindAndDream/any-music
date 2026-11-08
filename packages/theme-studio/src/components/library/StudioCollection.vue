<script setup lang="ts">
import { cloneCatalogTrackFilterState } from '@any-music/ui/catalog'
import type {
  UiThemeAvailability,
  UiThemeStatus,
  UiThemeTrackListActions,
  UiThemeTrackListState,
} from '@any-music/ui/theme'
import { computed } from 'vue'
import type { DeepReadonly } from 'vue'

import { useStudioActivity } from '../../composables/use-studio-activity'
import StudioFeatureStatus from '../StudioFeatureStatus.vue'
import StudioBatchActions from './StudioBatchActions.vue'
import StudioDisplayControls from './StudioDisplayControls.vue'
import StudioFilters from './StudioFilters.vue'
import StudioTrackTable from './StudioTrackTable.vue'

const props = defineProps<{
  title: string
  virtualized?: boolean
  scope: string
  state: DeepReadonly<UiThemeTrackListState>
  actions: UiThemeTrackListActions
  availability: UiThemeAvailability
  status: UiThemeStatus
  remove?: (ids: readonly string[]) => void | Promise<void>
  reorder?: (ids: readonly string[]) => void
  clear?: () => void | Promise<void>
}>()
defineSlots<{ header?: () => unknown; details?: (context: { trackId: string }) => unknown }>()
const { available, confirmAction } = useStudioActivity(() => props.availability)
const allSelected = computed(
  () =>
    props.state.tracks.length > 0 &&
    props.state.tracks.every((track) => props.state.selectedTrackIds.includes(track.id)),
)
function toggleAll() {
  if (!available()) return
  const visible = new Set(props.state.tracks.map((track) => track.id))
  props.actions.select(
    allSelected.value
      ? props.state.selectedTrackIds.filter((id) => !visible.has(id))
      : [...new Set([...props.state.selectedTrackIds, ...visible])],
  )
}
function removeSelected() {
  const ids = [...props.state.selectedTrackIds]
  if (ids.length)
    void confirmAction('移除已选歌曲', '确定移除已选歌曲？', () => props.remove?.(ids))
}
</script>
<template>
  <section class="studio-library" :aria-label="title">
    <header>
      <h1>{{ title }}</h1>
      <slot name="header" />
    </header>
    <StudioFeatureStatus :availability="availability" :status="status" />
    <fieldset :disabled="availability.status !== 'available'">
      <div class="studio-actions">
        <label class="studio-selection"
          ><input
            type="checkbox"
            :checked="allSelected"
            :disabled="!state.tracks.length"
            @change="toggleAll"
          />全选匹配歌曲</label
        >
        <span>已选 {{ state.selectedTrackIds.length }}</span>
        <StudioDisplayControls
          :state="state"
          :actions="actions"
          :disabled="availability.status !== 'available'"
        />
        <button
          type="button"
          @click="actions.setFilterDraft(cloneCatalogTrackFilterState(state.filters))"
        >
          筛选歌曲
        </button>
        <button
          v-if="props.remove"
          type="button"
          :disabled="!state.selectedTrackIds.length"
          @click="removeSelected"
        >
          移除已选
        </button>
        <button
          v-if="clear"
          type="button"
          :disabled="!state.tracks.length"
          @click="confirmAction('清空列表', '确定清空当前列表？', clear)"
        >
          清空列表
        </button>
      </div>
      <StudioBatchActions
        :state="state"
        :actions="actions"
        :scope="scope"
        :availability="availability"
      />
      <p v-if="!state.tracks.length && status.status !== 'loading'" role="status">当前没有歌曲。</p>
      <StudioTrackTable
        :virtualized="virtualized"
        :continuity-region="scope === 'favorites:tracks' ? scope : undefined"
        :state="state"
        :actions="actions"
        :disabled="availability.status !== 'available'"
        :reorder="reorder"
        ><template v-if="$slots.details" #details="context"
          ><slot name="details" v-bind="context" /></template
      ></StudioTrackTable>
      <StudioFilters :state="state" :actions="actions" :scope="scope" />
    </fieldset>
  </section>
</template>
