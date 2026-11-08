<script setup lang="ts">
import type { Track } from '@any-music/core'
import MusicListEmptyState from '@any-music/ui/components/music-sources/MusicListEmptyState.vue'
import type { UiThemeTrackListState } from '@any-music/ui/theme'
import { computed } from 'vue'
import type { DeepReadonly } from 'vue'

import type { useClassicCollectionPresentation } from '../../composables/use-classic-collection-presentation'
import QueuePlatformGrid from '../music-sources/QueuePlatformGrid.vue'
import QueuePlatformHeading from '../music-sources/QueuePlatformHeading.vue'
import QueueTrackGrid from '../music-sources/QueueTrackGrid.vue'
import QueueViewControls from '../music-sources/QueueViewControls.vue'
import ClassicCollectionSurface from './ClassicCollectionSurface.vue'
import PlaylistTrackHeading from './PlaylistTrackHeading.vue'

const props = defineProps<{
  title: string
  selectable: boolean
  favorites: boolean
  playlist?: boolean
  state: DeepReadonly<UiThemeTrackListState>
  mobileLayout: boolean
  totalCount: number
  presentation: ReturnType<typeof useClassicCollectionPresentation>
  overlayTarget: HTMLElement | null
  suspended: boolean
}>()
const emit = defineEmits<{
  select: [id: string]
  play: [id: string]
  favorite: [track: Track]
  download: [track: Track]
  showActions: [id: string]
  displayMode: [mode: UiThemeTrackListState['displayMode']]
  mobileColumns: [columns: UiThemeTrackListState['mobileColumns']]
  modalOpen: [open: boolean]
}>()
defineSlots<{
  header?: () => unknown
  navigation?: () => unknown
  actions?: () => unknown
}>()
const selected = computed(() => new Set(props.state.selectedTrackIds))
const favoriteIds = computed(() => new Set(props.state.favoriteTrackIds))
const invalidIds = computed(() => new Set(props.state.invalidTrackIds))
const intro = computed(() =>
  props.presentation.arrangement.value === 'platform'
    ? '勾选音乐源批量操作歌曲，长按平台卡片调整顺序。'
    : props.presentation.filtered.value
      ? '长按封面拖动排序，只调整匹配歌曲，未匹配歌曲保留原位。'
      : props.favorites
        ? '收藏每一首心动的音乐，长按封面调整顺序。'
        : props.playlist
          ? '长按封面调整歌单中的歌曲顺序。'
          : '把喜欢的音乐排进下一段时光，长按封面调整顺序。',
)
</script>

<template>
  <ClassicCollectionSurface
    :title="title"
    :total-count="totalCount"
    :intro="playlist ? undefined : intro"
    :mobile-layout="mobileLayout"
    :detail="Boolean(playlist || presentation.activePlatform.value)"
    :empty="!presentation.displayedTracks.value.length"
  >
    <template #controls>
      <PlaylistTrackHeading
        v-if="playlist && !presentation.activePlatform.value"
        :title="title"
        :arrangement-mode="presentation.arrangement.value"
        :display-mode="state.displayMode"
        :mobile-columns="state.mobileColumns"
        :overlay-target="overlayTarget"
        :suspended="suspended"
        hide-display
        @update-arrangement-mode="presentation.setArrangement"
        @update-display-mode="emit('displayMode', $event)"
        @update-mobile-columns="emit('mobileColumns', $event)"
        @modal-open-change="emit('modalOpen', $event)"
      >
        <template v-if="$slots.navigation" #navigation><slot name="navigation" /></template>
        <template v-if="$slots.actions && !presentation.compactControls.value" #actions>
          <slot name="actions" />
        </template>
      </PlaylistTrackHeading>
      <QueueViewControls
        v-else
        :collection-title="title"
        :arrangement-mode="presentation.arrangement.value"
        :display-mode="state.displayMode"
        :mobile-columns="state.mobileColumns"
        :overlay-target="overlayTarget"
        :suspended="suspended"
        hide-display
        @update-arrangement-mode="presentation.setArrangement"
        @update-display-mode="emit('displayMode', $event)"
        @update-mobile-columns="emit('mobileColumns', $event)"
        @modal-open-change="emit('modalOpen', $event)"
      >
        <template v-if="presentation.activePlatform.value" #default="{ openDisplay }">
          <QueuePlatformHeading
            :collection-title="title"
            :name="presentation.activePlatform.value.name"
            :total-count="presentation.activePlatform.value.totalCount"
            :visible-count="presentation.displayedTracks.value.length"
            :filtered="presentation.filtered.value"
            :is-custom="presentation.activePlatform.value.isCustom"
            :mobile-layout="mobileLayout"
            hide-display
            @back="presentation.navigation.back"
            @display="openDisplay"
          >
            <template v-if="$slots.actions && !presentation.compactControls.value" #actions>
              <slot name="actions" />
            </template>
          </QueuePlatformHeading>
        </template>
      </QueueViewControls>
    </template>
    <template v-if="$slots.header" #header><slot name="header" /></template>
    <div
      class="listen-queue__results"
      :class="{ 'listen-queue__results--empty': !presentation.displayedTracks.value.length }"
    >
      <Transition
        :name="`queue-view-${presentation.arrangement.value === 'flat' ? 'back' : 'forward'}`"
        @before-leave="presentation.deactivateLeavingView"
        @before-enter="presentation.activateView"
        @leave-cancelled="presentation.activateView"
      >
        <!-- Keep the arrangement controls in place while the two lists share the page slide. -->
        <div :key="presentation.arrangement.value" class="listen-queue__list">
          <MusicListEmptyState
            v-if="!presentation.displayedTracks.value.length"
            :icon="favorites ? 'heart' : 'queue'"
            :title="
              totalCount
                ? `没有匹配的${playlist ? '歌单' : favorites ? '喜欢' : '待听'}歌曲`
                : `还没有${playlist ? '歌单里的' : favorites ? '喜欢的' : '待听'}歌曲`
            "
            focus-title
            >{{
              totalCount
                ? '调整筛选条件，找到想听的音乐。'
                : playlist
                  ? '从音乐列表中选择歌曲并加入这个歌单。'
                  : favorites
                    ? '在发现、待听、我的歌单或自定义音乐中，喜欢心动的歌曲。'
                    : '在发现、我的喜欢、我的歌单或自定义音乐中，将想听的歌曲加入待听。'
            }}</MusicListEmptyState
          >
          <QueueTrackGrid
            :selectable="props.selectable"
            :animate="!presentation.reorder.isSettling.value"
            v-else-if="
              presentation.arrangement.value === 'flat' || presentation.activePlatform.value
            "
            :tracks="presentation.displayedTracks.value"
            :virtual="presentation.virtualGrid.value"
            :continuity-key="presentation.continuityRegion.value ?? undefined"
            :custom-tags-by-track-id="state.customTagsByTrackId"
            :custom-names-by-track-id="state.customNamesByTrackId"
            :date-label="favorites ? '喜欢' : '添加'"
            :positions="presentation.positions.value"
            :platform-names="state.platformNames"
            :added-at-ms-by-track-id="state.addedAtMsByTrackId"
            :current-track-id="state.currentTrackId ?? undefined"
            :selected-ids="selected"
            :dragged-id="presentation.reorder.draggedId.value"
            :get-reorder-style="(id) => presentation.reorder.getItemStyle('track', id)"
            :favorite-track-ids="favoriteIds"
            :invalid-track-ids="invalidIds"
            :download-busy="Boolean(state.downloadBusy)"
            :display-mode="state.displayMode"
            :mobile-columns="state.mobileColumns"
            @select="emit('select', $event)"
            @play="emit('play', $event)"
            @favorite="emit('favorite', $event)"
            @download="emit('download', $event)"
            @show-actions="emit('showActions', $event)"
            @drag-start="presentation.reorder.startTrackPress"
            @shift="(id, direction) => presentation.reorder.shift('track', id, direction)"
            @drag-cancel="presentation.reorder.clearDrag"
          />
          <QueuePlatformGrid
            v-else
            :groups="presentation.groups.value"
            :continuity-key="presentation.continuityRegion.value ?? undefined"
            :virtual="presentation.virtualGrid.value"
            :selected-ids="selected"
            :selectable="props.selectable"
            :filtered="presentation.filtered.value"
            :dragged-id="
              presentation.reorder.dragKind.value === 'platform'
                ? presentation.reorder.draggedId.value
                : undefined
            "
            :get-reorder-style="(id) => presentation.reorder.getItemStyle('platform', id)"
            :animate="!presentation.reorder.isSettling.value"
            :display-mode="state.displayMode"
            :mobile-columns="state.mobileColumns"
            @open="presentation.navigation.open"
            @select="presentation.togglePlatform"
            @drag-start="presentation.reorder.startPlatformPress"
            @shift="(id, direction) => presentation.reorder.shift('platform', id, direction)"
            @drag-cancel="presentation.reorder.clearDrag"
          />
        </div>
      </Transition>
    </div>
  </ClassicCollectionSurface>
</template>
