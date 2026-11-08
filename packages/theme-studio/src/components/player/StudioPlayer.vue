<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { playbackModeOptions } from '@any-music/ui/components/music-sources/playback-mode-options.ts'
import RemoteImage from '@any-music/ui/components/music-sources/RemoteImage.vue'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed } from 'vue'

import StudioFeatureStatus from '../StudioFeatureStatus.vue'

const props = defineProps<{ feature: UiThemeFeatureMap['player'] }>()
const enabled = computed(() => props.feature.availability.status === 'available')
const playable = computed(
  () =>
    enabled.value &&
    Boolean(props.feature.state.track) &&
    props.feature.status.status !== 'loading',
)
function seek(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (enabled.value && props.feature.state.canSeek && Number.isFinite(value))
    props.feature.actions.seek(Math.max(0, Math.min(props.feature.state.durationMs, value)))
}
function setVolume(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (enabled.value && Number.isFinite(value))
    props.feature.actions.setVolume(Math.max(0, Math.min(1, value)))
}
function setQuality(event: Event): void {
  const quality = props.feature.state.qualities.find(
    (item) => item.id === (event.target as HTMLSelectElement).value,
  )
  if (enabled.value && quality) void props.feature.actions.setQuality(quality)
}
function time(value: number): string {
  const seconds = Math.floor(Math.max(0, Number.isFinite(value) ? value : 0) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
</script>

<template>
  <section class="studio-player" aria-label="音乐播放器">
    <p class="studio-eyebrow">正在播放</p>
    <RemoteImage
      v-if="feature.state.track?.artworkUrl"
      class="studio-player__art"
      :src="feature.state.track.artworkUrl"
      :alt="feature.state.track.title"
    />
    <div v-else class="studio-player__art studio-player__placeholder">
      <AppIcon name="waveform" />
    </div>
    <h2>{{ feature.state.track?.title ?? '选择一首音乐' }}</h2>
    <p>{{ feature.state.track?.artists.map((artist) => artist.name).join(' / ') }}</p>
    <StudioFeatureStatus :availability="feature.availability" :status="feature.status" />
    <p v-if="feature.state.statusLabel" role="status">{{ feature.state.statusLabel }}</p>
    <div class="studio-transport">
      <button
        type="button"
        aria-label="上一首"
        :disabled="!playable"
        @click="feature.actions.previous"
      >
        <AppIcon name="previous" />
      </button>
      <button
        type="button"
        :aria-label="feature.state.playing ? '暂停' : '播放'"
        data-am-focus-key="player:toggle"
        :disabled="!playable"
        @click="feature.state.playing ? feature.actions.pause() : feature.actions.play()"
      >
        <AppIcon :name="feature.state.playing ? 'pause' : 'play'" />
      </button>
      <button type="button" aria-label="下一首" :disabled="!playable" @click="feature.actions.next">
        <AppIcon name="next" />
      </button>
    </div>
    <label class="studio-field"
      >精确播放进度<input
        type="range"
        min="0"
        :max="feature.state.durationMs"
        step="100"
        :value="feature.state.positionMs"
        :disabled="!enabled || !feature.state.canSeek"
        :aria-valuetext="`${time(feature.state.positionMs)} / ${time(feature.state.durationMs)}`"
        aria-label="精确播放进度"
        data-am-focus-key="player:seek"
        @change="seek"
    /></label>
    <p class="studio-time">
      {{ time(feature.state.positionMs) }} <span>{{ time(feature.state.durationMs) }}</span>
    </p>
    <progress
      :value="feature.state.bufferedUntilMs ?? 0"
      :max="feature.state.durationMs || 1"
      aria-label="缓冲进度"
    ></progress>
    <label class="studio-field"
      >音量<input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="feature.state.volume"
        :disabled="!enabled"
        aria-label="音量"
        @input="setVolume"
    /></label>
    <label class="studio-field"
      >播放速度<select
        aria-label="播放速度"
        :value="feature.state.playbackRate"
        :disabled="!enabled"
        @change="
          feature.actions.setPlaybackRate(Number(($event.target as HTMLSelectElement).value))
        "
      >
        <option v-for="rate in [0.5, 0.75, 1, 1.25, 1.5, 2]" :key="rate" :value="rate">
          {{ rate }}×
        </option>
      </select></label
    >
    <label class="studio-field"
      >播放模式<select
        aria-label="播放模式"
        :value="feature.state.mode"
        :disabled="!enabled"
        @change="
          feature.actions.setMode(
            ($event.target as HTMLSelectElement).value as typeof feature.state.mode,
          )
        "
      >
        <option v-for="mode in playbackModeOptions" :key="mode.value" :value="mode.value">
          {{ mode.label }}
        </option>
      </select></label
    >
    <label class="studio-field"
      >音质<select
        aria-label="音质"
        :value="feature.state.quality.id"
        :disabled="!enabled || !feature.state.qualities.length"
        @change="setQuality"
      >
        <option v-for="quality in feature.state.qualities" :key="quality.id" :value="quality.id">
          {{ quality.label }}
        </option>
      </select></label
    >
    <button
      type="button"
      :disabled="!enabled || !feature.state.canDownload"
      @click="feature.state.canDownload && feature.actions.download()"
    >
      <AppIcon name="download" />下载当前歌曲
    </button>
    <button
      v-if="feature.status.status === 'error' || feature.status.status === 'invalid'"
      type="button"
      :disabled="!enabled"
      @click="feature.actions.retry"
    >
      重试播放
    </button>
  </section>
</template>
