<script setup lang="ts">
import type { UiPlayerState, UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed } from 'vue'

import PlayerBar from './PlayerBar.vue'

const props = defineProps<{
  feature: UiThemeFeatureMap['player']
  mobileOverlayTarget?: HTMLElement | null
}>()
const emit = defineEmits<{
  mobileExpandedChange: [value: boolean]
  settingsOpenChange: [value: boolean]
}>()
const state = computed<UiPlayerState>(() => ({
  positionMs: props.feature.state.positionMs,
  durationMs: props.feature.state.durationMs,
  bufferedUntilMs: props.feature.state.bufferedUntilMs ?? 0,
  playing: props.feature.state.playing,
  seekDisabled: !props.feature.state.canSeek,
  volume: props.feature.state.volume,
  playbackRate: props.feature.state.playbackRate,
  qualityOptions: props.feature.state.qualities,
  selectedQualityId: props.feature.state.quality.id,
  status:
    props.feature.status.status === 'loading'
      ? 'resolving'
      : props.feature.status.status === 'error' || props.feature.status.status === 'invalid'
        ? 'error'
        : props.feature.state.track
          ? 'ready'
          : 'idle',
  statusLabel:
    props.feature.state.statusLabel ??
    (props.feature.availability.status !== 'available'
      ? props.feature.availability.reason
      : props.feature.status.status === 'error' || props.feature.status.status === 'invalid'
        ? props.feature.status.error.message
        : ''),
}))
function seekBy(seconds: number): void {
  if (props.feature.state.canSeek)
    props.feature.actions.seek(
      Math.min(
        props.feature.state.durationMs,
        Math.max(0, props.feature.state.positionMs + seconds * 1000),
      ),
    )
}
function selectQuality(id: string): void {
  const quality = props.feature.state.qualities.find((entry) => entry.id === id)
  if (quality) void props.feature.actions.setQuality(quality)
}
</script>

<template>
  <PlayerBar
    :state="state"
    :track="feature.state.track ?? undefined"
    :mode="feature.state.mode"
    :download-busy="false"
    :mobile-overlay-target="mobileOverlayTarget"
    :can-download="feature.state.canDownload"
    @mobile-expanded-change="emit('mobileExpandedChange', $event)"
    @settings-open-change="emit('settingsOpenChange', $event)"
    :inert="feature.availability.status !== 'available' || undefined"
    @play="feature.actions.play"
    @pause="feature.actions.pause"
    @previous="feature.actions.previous"
    @next="feature.actions.next"
    @seek="feature.actions.seek"
    @seek-by="seekBy"
    @select-quality="selectQuality"
    @set-volume="feature.actions.setVolume"
    @set-playback-rate="feature.actions.setPlaybackRate"
    @update-mode="feature.actions.setMode"
    @download="feature.state.canDownload && feature.actions.download()"
  />
</template>
