<script setup lang="ts">
import CollectionGrid from '@any-music/ui/components/CollectionGrid.vue'
import MusicListEmptyState from '@any-music/ui/components/music-sources/MusicListEmptyState.vue'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed } from 'vue'

import type { useClassicHistory } from '../../composables/use-classic-history'
import QueuePlatformGroup from '../music-sources/QueuePlatformGroup.vue'
import QueuePlatformHeading from '../music-sources/QueuePlatformHeading.vue'
import QueueViewControls from '../music-sources/QueueViewControls.vue'
import TrackRow from '../music-sources/TrackRow.vue'
import ClassicCollectionSurface from './ClassicCollectionSurface.vue'
import { formatHistoryRecord } from './history-record-presentation'

const props = defineProps<{
  feature: UiThemeFeatureMap['history']
  presentation: ReturnType<typeof useClassicHistory>
  overlayTarget: HTMLElement | null
}>()
const { history, navigation, filtered, activePlatform } = props.presentation
const groups = computed(() => props.presentation.groups.value.filter(({ count }) => count > 0))
const itemKeys = computed(() => history.visible.value.map(({ entry }) => entry.id))
const intro = computed(() =>
  history.arrangement.value === 'platform'
    ? '勾选音乐源批量操作播放记录，点击平台卡片查看历史。'
    : '回顾听过的音乐，每次播放都会单独记录。',
)
</script>

<template>
  <ClassicCollectionSurface
    title="播放历史"
    count-unit="条"
    :total-count="history.rows.value.length"
    :intro="intro"
    :mobile-layout="feature.state.mobileLayout"
    :detail="Boolean(activePlatform)"
    :empty="!history.visible.value.length"
  >
    <template #controls>
      <QueueViewControls
        collection-title="播放历史"
        flat-label="全部记录"
        platform-hint="按音乐平台查看播放记录"
        :arrangement-mode="history.arrangement.value"
        :display-mode="history.displayMode.value"
        :mobile-columns="history.mobileColumns.value"
        :overlay-target="overlayTarget"
        :suspended="feature.availability.status !== 'available' || history.draft.value !== null"
        hide-display
        @update-arrangement-mode="history.setArrangement"
        @update-display-mode="history.displayMode.value = $event"
        @update-mobile-columns="history.mobileColumns.value = $event"
        @modal-open-change="presentation.contentDisplayOpen.value = $event"
      >
        <template v-if="activePlatform" #default="{ openDisplay }">
          <QueuePlatformHeading
            collection-title="播放历史"
            count-unit="条"
            :name="activePlatform.name"
            :total-count="activePlatform.totalCount"
            :visible-count="history.visible.value.length"
            :filtered="filtered"
            :is-custom="activePlatform.isCustom"
            :mobile-layout="feature.state.mobileLayout"
            hide-display
            @back="navigation.back"
            @display="openDisplay"
          />
        </template>
      </QueueViewControls>
    </template>
    <div
      class="listen-queue__results"
      :class="{ 'listen-queue__results--empty': !history.visible.value.length }"
    >
      <Transition
        :name="`queue-view-${history.arrangement.value === 'flat' ? 'back' : 'forward'}`"
        @before-leave="presentation.deactivateLeavingView"
        @before-enter="presentation.activateView"
        @leave-cancelled="presentation.activateView"
      >
        <div :key="history.arrangement.value" class="listen-queue__list">
          <MusicListEmptyState
            v-if="!history.visible.value.length"
            icon="history"
            :title="history.rows.value.length ? '没有匹配的播放记录' : '还没有播放历史'"
            focus-title
          >
            {{
              history.rows.value.length
                ? '调整筛选条件，找到想听的音乐。'
                : '播放喜欢的音乐后，在这里回顾每一次聆听。'
            }}
          </MusicListEmptyState>
          <CollectionGrid
            v-else-if="history.arrangement.value === 'platform' && !activePlatform"
            class="listen-queue__groups"
            :data-display-mode="history.displayMode.value"
            :data-mobile-columns="history.mobileColumns.value"
          >
            <QueuePlatformGroup
              :selectable="history.operatorOpen.value"
              v-for="group in groups"
              :key="group.id"
              :platform-id="group.id"
              :name="group.name"
              :count="group.count"
              :total-count="group.totalCount"
              :filtered="filtered"
              :is-custom="group.isCustom"
              :dragging="false"
              history-records
              :selected="group.selectedCount === group.count"
              :indeterminate="group.selectedCount > 0 && group.selectedCount < group.count"
              @open="navigation.open(group.id)"
              @select="history.togglePlatform(group.id)"
            />
          </CollectionGrid>
          <TrackCardGrid
            v-else
            :display-mode="history.displayMode.value"
            :mobile-columns="history.mobileColumns.value"
            :item-keys="itemKeys"
            animate
          >
            <div
              v-for="{ entry, track } in history.visible.value"
              :key="entry.id"
              class="history-record list__cell"
            >
              <TrackRow
                :selectable="history.operatorOpen.value"
                :track="track"
                :custom-tags="feature.state.customTagsByTrackId.get(track.id)"
                :active="track.id === feature.state.currentTrackId"
                :invalid="feature.state.invalidTrackIds.includes(track.id)"
                :favorite="feature.state.favoriteTrackIds.includes(track.id)"
                :download-busy="Boolean(feature.state.downloadBusy)"
                :selected="history.selectedIds.value.includes(entry.id)"
                :display-mode="history.displayMode.value"
                :context-label="
                  feature.state.platformNames.get(track.source.pluginId) ?? track.source.pluginId
                "
                :trailing-meta="formatHistoryRecord(entry)"
                :focus-id="entry.id"
                :selection-description="`${feature.state.customNamesByTrackId.get(track.id) ?? track.title} 的${formatHistoryRecord(entry)}记录`"
                @select="history.select(entry.id)"
                @play="presentation.play(track.id)"
                @favorite="feature.actions.toggleFavorite(track.id)"
                @download="feature.actions.download([track.id])"
                @show-actions="presentation.actionEntryId.value = entry.id"
              />
            </div>
          </TrackCardGrid>
        </div>
      </Transition>
    </div>
  </ClassicCollectionSurface>
</template>

<style scoped>
.history-record {
  container: am-track-card / inline-size;
  display: grid;
  min-inline-size: 0;
}
</style>
