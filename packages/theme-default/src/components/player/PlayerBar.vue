<script setup lang="ts">
import {
  AppIcon,
  CompactAudioSeekBar,
  PlayerControlPager,
  PrecisionAudioSeekBar,
  RemoteImage,
  useMobilePlayerSheet,
  useOverlayKeyboard,
  useTrackName,
} from '@any-music/ui'
import type { UiPlayerProps, UiPlayerEmits } from '@any-music/ui/theme'
import { computed, nextTick, onScopeDispose, shallowRef, useTemplateRef, watch } from 'vue'

import type { PlayerSettingKind } from './player-control-options'
import PlayerControlActions from './PlayerControlActions.vue'
import PlayerSettingsDialog from './PlayerSettingsDialog.vue'

const props = withDefaults(defineProps<UiPlayerProps>(), { canDownload: true })
const emit = defineEmits<UiPlayerEmits>()
const mobileCloseButton = useTemplateRef<HTMLButtonElement>('mobileCloseButton')
const mobilePanel = useTemplateRef<HTMLElement>('mobilePanel')
const controlPager = useTemplateRef<InstanceType<typeof PlayerControlPager>>('controlPager')
const activeSetting = shallowRef<PlayerSettingKind>()
const mobilePanelScrollTop = shallowRef(0)
const { customName, displayName } = useTrackName(() => props.track)
let shouldRestoreMobileFocus = false
const mobilePlayerQuery = window.matchMedia('(max-width: 576px)')
const isMobileViewport = shallowRef(mobilePlayerQuery.matches)
const mobileSheet = useMobilePlayerSheet({
  enabled: () => isMobileViewport.value && Boolean(props.mobileOverlayTarget),
  getHeight: () => props.mobileOverlayTarget?.getBoundingClientRect().height ?? window.innerHeight,
  getScrollTop: () => mobilePanel.value?.scrollTop ?? 0,
})
const {
  isExpanded: isMobileExpanded,
  isVisible: isMobilePanelVisible,
  isDragging: isMobileDragging,
} = mobileSheet
const mobilePanelStyle = computed(() => ({
  '--am-player-sheet-offset': `${mobileSheet.offsetPercentage.value}%`,
}))

const artistLabel = computed(
  () => props.track?.artists.map((artist) => artist.name).join('、') || '选择一首音乐开始播放',
)

// 正常原生播放的状态文案就是作者；只有独立播放状态或错误才另占一行。
const detailStatusLabel = computed(() => {
  const artists = props.track?.artists.map((artist) => artist.name).join(' / ')
  return props.state.statusLabel === artists || props.state.statusLabel === artistLabel.value
    ? ''
    : props.state.statusLabel
})

function openSetting(setting: PlayerSettingKind): void {
  activeSetting.value = setting
}

function requestDownload(): void {
  if (!props.track || props.canDownload === false) return
  // 下载进行中也保留入口，让每次点击都能查看歌曲当时的状态。
  emit('download', props.track)
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !mobilePanel.value) return
  // 全屏播放器是模态层；循环焦点可避免键盘落到背后的迷你播放器与页面导航。
  const focusable = [
    ...mobilePanel.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ]
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) return
  const root = mobilePanel.value.getRootNode()
  const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(isMobileExpanded, async (isExpanded) => {
  emit('mobileExpandedChange', isExpanded)
  if (!isExpanded) {
    activeSetting.value = undefined
    shouldRestoreMobileFocus = true
    return
  }
  shouldRestoreMobileFocus = false
  mobilePanelScrollTop.value = 0
  await nextTick()
  if (isMobileExpanded.value && !activeSetting.value)
    mobileCloseButton.value?.focus({ preventScroll: true })
})

watch(activeSetting, (setting) => emit('settingsOpenChange', setting !== undefined))

function handleMobilePanelAfterLeave(): void {
  if (!shouldRestoreMobileFocus) return
  shouldRestoreMobileFocus = false
  if (mobilePlayerQuery.matches) controlPager.value?.focusCurrentPage()
}

useOverlayKeyboard({
  active: () => isMobileExpanded.value && !activeSetting.value,
  layer: 'modal',
  onEscape: mobileSheet.collapse,
  onTab: handleWindowKeydown,
})
const handleMobilePlayerViewportChange = (event: MediaQueryListEvent): void => {
  isMobileViewport.value = event.matches
  // 扩宽到桌面布局时完整播放器已不可见，必须同步释放外层壳的模态状态。
  if (!event.matches) {
    mobileSheet.collapse()
  }
}
mobilePlayerQuery.addEventListener('change', handleMobilePlayerViewportChange)
onScopeDispose(() => {
  if (isMobileExpanded.value) emit('mobileExpandedChange', false)
  if (activeSetting.value) emit('settingsOpenChange', false)
  mobilePlayerQuery.removeEventListener('change', handleMobilePlayerViewportChange)
})
</script>

<template>
  <footer
    class="player"
    :class="{ 'player--active': props.track, 'player--dragging': isMobileDragging }"
    @pointerdown.capture="mobileSheet.handlePointerDown"
    @pointermove.capture="mobileSheet.handlePointerMove"
    @pointerup.capture="mobileSheet.handlePointerEnd"
    @pointercancel.capture="mobileSheet.handlePointerCancel"
    @lostpointercapture.capture="mobileSheet.handlePointerCancel"
    @click.capture="mobileSheet.handleClick"
  >
    <CompactAudioSeekBar
      v-if="isMobileViewport"
      :key="props.track?.id"
      class="player__edge-seek"
      :position-ms="props.state.positionMs"
      :duration-ms="props.state.durationMs"
      :buffered-until-ms="props.state.bufferedUntilMs"
      :disabled="props.state.seekDisabled"
      :aria-hidden="isMobileExpanded ? 'true' : undefined"
      :inert="isMobileExpanded || undefined"
      @seek="emit('seek', $event)"
    />

    <button
      class="player__mobile-drag-target"
      data-player-sheet-handle
      type="button"
      aria-label="向上拖动或点击展开播放器"
      :aria-hidden="isMobileExpanded ? 'true' : undefined"
      :inert="isMobileExpanded ? true : undefined"
      @click="mobileSheet.expand"
    >
      <span class="player__mobile-handle" aria-hidden="true"></span>
    </button>

    <PlayerControlPager ref="controlPager" :mobile="isMobileViewport" :disabled="isMobileExpanded">
      <div class="player__playback-page">
        <div
          class="player__track"
          :aria-hidden="isMobileExpanded ? 'true' : undefined"
          :inert="isMobileExpanded ? true : undefined"
        >
          <RemoteImage
            v-if="props.track?.artworkUrl"
            class="player__artwork"
            :src="props.track.artworkUrl"
            :alt="`${props.track.title}封面`"
            loading="eager"
          />
          <span v-else class="player__artwork player__artwork--empty" aria-hidden="true">
            <AppIcon name="music" />
          </span>
          <div class="player__info">
            <strong class="player__title" :title="displayName">{{
              displayName ?? '未选择音乐'
            }}</strong>
            <span class="player__artist" :title="artistLabel">{{ artistLabel }}</span>
            <span class="player__status" aria-live="polite">{{ props.state.statusLabel }}</span>
          </div>
        </div>

        <div
          class="player__transport"
          :aria-hidden="isMobileExpanded ? 'true' : undefined"
          :inert="isMobileExpanded ? true : undefined"
        >
          <div class="player__transport-controls">
            <button
              class="player__button"
              type="button"
              title="上一首"
              aria-label="上一首"
              @click="emit('previous')"
            >
              <AppIcon name="previous" />
            </button>
            <button
              class="player__button player__button--seek"
              type="button"
              title="后退 10 秒"
              aria-label="后退 10 秒"
              @click="emit('seekBy', -10)"
            >
              <AppIcon name="replay-10" />
            </button>
            <button
              class="player__button player__button--primary"
              type="button"
              :disabled="!props.track || props.state.status === 'resolving'"
              :aria-label="props.state.playing ? '暂停' : '播放'"
              @click="props.state.playing ? emit('pause') : emit('play')"
            >
              <AppIcon :name="props.state.playing ? 'pause' : 'play'" />
            </button>
            <button
              class="player__button player__button--seek"
              type="button"
              title="前进 10 秒"
              aria-label="前进 10 秒"
              @click="emit('seekBy', 10)"
            >
              <AppIcon name="forward-10" />
            </button>
            <button
              class="player__button"
              type="button"
              title="下一首"
              aria-label="下一首"
              @click="emit('next')"
            >
              <AppIcon name="next" />
            </button>
          </div>

          <PrecisionAudioSeekBar
            :position-ms="props.state.positionMs"
            :duration-ms="props.state.durationMs"
            :buffered-until-ms="props.state.bufferedUntilMs"
            :disabled="props.state.seekDisabled"
            @seek="emit('seek', $event)"
          />
        </div>

        <div
          class="player__extras"
          :aria-hidden="isMobileExpanded ? 'true' : undefined"
          :inert="isMobileExpanded ? true : undefined"
        >
          <PlayerControlActions
            :mode="props.mode"
            :playback-rate="props.state.playbackRate"
            :has-track="Boolean(props.track) && props.canDownload !== false"
            :quality-disabled="props.state.status === 'resolving'"
            @open-setting="openSetting"
            @download="requestDownload"
          />
        </div>
      </div>
      <template #actions>
        <PlayerControlActions
          class="player__mobile-actions"
          :mode="props.mode"
          :playback-rate="props.state.playbackRate"
          :has-track="Boolean(props.track) && props.canDownload !== false"
          :quality-disabled="props.state.status === 'resolving'"
          @open-setting="openSetting"
          @download="requestDownload"
        />
      </template>
    </PlayerControlPager>

    <!-- Teleport 保留组件逻辑归属，同时让全屏层脱离底部控制栏的网格区域。 -->
    <Teleport v-if="props.mobileOverlayTarget" :to="props.mobileOverlayTarget">
      <Transition
        name="am-now-playing"
        :css="!isMobileDragging"
        @after-leave="handleMobilePanelAfterLeave"
      >
        <section
          v-if="isMobilePanelVisible"
          ref="mobilePanel"
          class="player__now-playing"
          :class="{
            'player__now-playing--dragging': isMobileDragging,
            'player__now-playing--scrolled': mobilePanelScrollTop > 0,
          }"
          :style="mobilePanelStyle"
          role="dialog"
          :aria-modal="isMobileExpanded && !activeSetting ? 'true' : undefined"
          aria-label="正在播放详情"
          :aria-hidden="activeSetting || !isMobileExpanded ? 'true' : undefined"
          :inert="Boolean(activeSetting) || !isMobileExpanded || undefined"
          @pointerdown.capture="mobileSheet.handlePointerDown"
          @pointermove.capture="mobileSheet.handlePointerMove"
          @pointerup.capture="mobileSheet.handlePointerEnd"
          @pointercancel.capture="mobileSheet.handlePointerCancel"
          @lostpointercapture.capture="mobileSheet.handlePointerCancel"
          @click.capture="mobileSheet.handleClick"
          @scroll="mobilePanelScrollTop = mobilePanel?.scrollTop ?? 0"
        >
          <header class="player__now-playing-header">
            <button
              ref="mobileCloseButton"
              type="button"
              aria-label="收起播放器"
              @click="mobileSheet.collapse"
            >
              <AppIcon name="chevron-down" />
            </button>
            <strong>正在播放</strong>
            <span></span>
          </header>
          <div class="player__now-playing-copy">
            <h2>{{ displayName ?? '未选择音乐' }}</h2>
            <p v-if="customName" class="player__now-playing-original">
              原名：{{ props.track?.title }}
            </p>
            <p>{{ artistLabel }}</p>
          </div>
          <div class="player__now-playing-space" aria-hidden="true"></div>
          <PrecisionAudioSeekBar
            :position-ms="props.state.positionMs"
            :duration-ms="props.state.durationMs"
            :buffered-until-ms="props.state.bufferedUntilMs"
            :disabled="props.state.seekDisabled"
            @seek="emit('seek', $event)"
          />
          <div class="player__now-playing-controls">
            <button type="button" aria-label="上一首" @click="emit('previous')">
              <AppIcon name="previous" />
            </button>
            <button
              class="player__button--primary"
              type="button"
              :disabled="!props.track || props.state.status === 'resolving'"
              :aria-label="props.state.playing ? '暂停' : '播放'"
              @click="props.state.playing ? emit('pause') : emit('play')"
            >
              <AppIcon :name="props.state.playing ? 'pause' : 'play'" />
            </button>
            <button type="button" aria-label="下一首" @click="emit('next')">
              <AppIcon name="next" />
            </button>
          </div>
          <div class="player__now-playing-seek-actions" role="group" aria-label="快速跳转">
            <button
              type="button"
              :disabled="props.state.seekDisabled"
              aria-label="后退 10 秒"
              @click="emit('seekBy', -10)"
            >
              <AppIcon name="replay-10" />
            </button>
            <button
              type="button"
              :disabled="props.state.seekDisabled"
              aria-label="前进 10 秒"
              @click="emit('seekBy', 10)"
            >
              <AppIcon name="forward-10" />
            </button>
          </div>
          <PlayerControlActions
            class="player__now-playing-actions"
            :mode="props.mode"
            :playback-rate="props.state.playbackRate"
            :has-track="Boolean(props.track) && props.canDownload !== false"
            :quality-disabled="props.state.status === 'resolving'"
            @open-setting="openSetting"
            @download="requestDownload"
          />
          <p v-if="detailStatusLabel" class="player__now-playing-status" aria-live="polite">
            {{ detailStatusLabel }}
          </p>
        </section>
      </Transition>
    </Teleport>
    <Teleport v-if="props.mobileOverlayTarget" :to="props.mobileOverlayTarget">
      <PlayerSettingsDialog
        :setting="activeSetting"
        :mode="props.mode"
        :quality-options="props.state.qualityOptions"
        :selected-quality-id="props.state.selectedQualityId"
        :playback-rate="props.state.playbackRate"
        :volume="props.state.volume"
        @close="activeSetting = undefined"
        @update-mode="emit('updateMode', $event)"
        @select-quality="emit('selectQuality', $event)"
        @set-playback-rate="emit('setPlaybackRate', $event)"
        @set-volume="emit('setVolume', $event)"
      />
    </Teleport>
  </footer>
</template>

<style scoped>
.player {
  /* 不建立 size containment：完整播放器的 fixed 面板必须以移动应用壳为包含块。 */
  position: relative;
  display: grid;
  /* 两侧等宽才能让播放区对齐整条控制栏中心，曲名长度和设置按钮不会推偏中线。 */
  grid-template-columns: minmax(0, 1fr) minmax(260px, 1.5fr) minmax(0, 1fr);
  align-items: center;
  gap: var(--am-space-4);
  min-block-size: var(--am-size-player);
  padding: var(--am-space-3) var(--am-space-5);
  border-block-start: 1px solid var(--am-color-border);
  background: var(--am-color-surface);
  box-shadow: var(--am-shadow-navigation);
  backdrop-filter: blur(22px) saturate(140%);
}

.player__playback-page {
  /* 桌面继续由原控制栏直接排列曲目、播放和设置，分页包装层不额外占据网格列。 */
  display: contents;
}

@supports (background: color-mix(in srgb, white 50%, transparent)) {
  .player {
    background: color-mix(in srgb, var(--am-color-surface) 94%, transparent);
  }
}

.player__audio {
  display: none;
}

.player__track,
.player__transport,
.player__transport-controls,
.player__extras {
  display: flex;
  align-items: center;
}

.player__track {
  min-inline-size: 0;
  gap: var(--am-space-3);
}

.player__artwork {
  inline-size: 50.4px;
  block-size: 50.4px;
  flex: 0 0 auto;
  border-radius: var(--am-radius-md);
  object-fit: cover;
  box-shadow: var(--am-shadow-control);
}

.player__artwork--empty {
  display: grid;
  place-items: center;
  background: var(--am-color-brand);
  color: var(--am-color-on-brand);
}

.player__info {
  display: grid;
  flex: 1 1 0;
  min-inline-size: 0;
}

.player__title,
.player__artist,
.player__status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player__title {
  color: var(--am-color-text);
  font-size: var(--am-font-size-sm);
}

.player__artist,
.player__status {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.player__transport {
  min-inline-size: 0;
  inline-size: 100%;
  max-inline-size: 560px;
  justify-self: center;
  flex-direction: column;
  gap: var(--am-space-1);
}

.player__transport-controls {
  justify-content: center;
  gap: var(--am-space-2);
}

.player__button,
.player__now-playing button {
  inline-size: var(--am-size-control);
  block-size: var(--am-size-control);
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-pill);
  background: transparent;
  color: var(--am-color-text);
  cursor: pointer;
  transition:
    transform var(--am-motion-fast) var(--am-ease-standard),
    background-color var(--am-motion-fast) var(--am-ease-standard);
}

.player__button--primary,
.player__now-playing .player__button--primary {
  inline-size: 45.6px;
  block-size: 45.6px;
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}

.player__button:disabled,
.player__now-playing button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.player__extras {
  justify-content: flex-end;
}

.player__mobile-drag-target,
.player__now-playing {
  display: none;
}

@media (hover: hover) {
  .player__button:not(.player__button--primary):hover,
  .player__now-playing button:not(.player__button--primary):hover {
    background: var(--am-color-hover);
  }
}

.player__button:active,
.player__now-playing button:active {
  transform: scale(0.91);
}

/* 壳内播放器宽度会受侧栏开合影响，中间档必须查询播放器插槽而不是浏览器视口。 */
@container am-player (max-width: 1040px) {
  .player {
    grid-template:
      'track extras' auto
      'transport transport' auto
      / minmax(0, 1fr) auto;
    gap: var(--am-space-2) var(--am-space-4);
    padding: var(--am-space-3) var(--am-space-4);
  }

  .player__track {
    grid-area: track;
  }

  .player__transport {
    grid-area: transport;
    flex-direction: row;
    gap: var(--am-space-4);
  }

  .player__transport-controls {
    flex: 0 0 auto;
  }

  .player__transport > :deep(.player__precision-seek) {
    flex: 1 1 auto;
  }

  .player__extras {
    grid-area: extras;
  }
}

@container am-player (max-width: 760px) {
  .player {
    column-gap: var(--am-space-2);
  }

  .player__button--seek {
    display: none;
  }

  .player__transport {
    gap: var(--am-space-2);
  }

  .player__transport-controls {
    gap: var(--am-space-1);
  }
}

/* 桌面窗口很窄但尚未进入手机断点时，操作区另占一行，避免挤压曲名。 */
@container am-player (max-width: 520px) {
  .player {
    grid-template:
      'track' auto
      'transport' auto
      'extras' auto
      / minmax(0, 1fr);
  }

  .player__extras {
    justify-content: center;
  }
}

@media (max-width: 576px) {
  .player {
    /* 手机才将分页器作为单个网格项，覆盖桌面的列与命名区域。 */
    grid-template: auto / minmax(0, 1fr);
    min-block-size: var(--am-size-mobile-player);
    gap: 0;
    padding: var(--am-space-2) var(--am-space-3);
    padding-block-start: 24px;
    /* 增加底部留白，让控制页离手柄更远并整体上移，同时保留顶边进度的独立热区。 */
    padding-block-end: calc(
      max(var(--am-space-2), env(safe-area-inset-bottom)) + var(--am-space-2)
    );
    border-block-start: 0;
    cursor: grab;
  }

  .player--dragging {
    cursor: grabbing;
  }

  .player__edge-seek {
    /* 细轨贴住控制栏上边缘；44px 热区独立于下方纵向展开手柄。 */
    position: absolute;
    z-index: 3;
    inset-inline: 0;
    inset-block-start: calc(var(--am-size-player-edge-seek, 44px) / -2);
  }

  .player :deep(.player-control-pager--mobile .player-control-pager__playback) {
    padding-inline-end: 0;
  }

  .player__playback-page {
    display: grid;
    /* 等宽左右留白固定播放组中线；右列留给翻页入口，左列文字可缩短。 */
    grid-template: 'track transport spare' auto / minmax(0, 1fr) auto minmax(0, 1fr);
    min-inline-size: 0;
    align-items: center;
    gap: 0;
  }

  .player__mobile-drag-target {
    position: absolute;
    inset: 0;
    display: block;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: grab;
    touch-action: none;
  }

  .player__mobile-handle {
    position: absolute;
    inset-block-end: 2px;
    inset-inline-start: 50%;
    inline-size: 40px;
    block-size: 3px;
    border-radius: var(--am-radius-pill);
    background: var(--am-color-border-strong);
    transform: translateX(-50%);
  }

  .player--dragging .player__mobile-drag-target {
    cursor: grabbing;
  }

  .player__track,
  .player__transport-controls {
    position: relative;
    z-index: 1;
  }

  .player__track {
    grid-area: track;
    gap: var(--am-space-2);
    overflow: hidden;
    touch-action: none;
  }

  .player__artwork {
    inline-size: 32px;
    block-size: 32px;
  }

  .player__status,
  .player__transport > :deep(.player__precision-seek),
  .player__extras,
  .player__button--seek {
    display: none;
  }

  .player__transport {
    grid-area: transport;
    /* 居中组宽度不由曲名决定，保留两侧相同的可压缩空间。 */
    inline-size: auto;
    max-inline-size: none;
    justify-self: center;
    align-items: center;
    flex-direction: column;
  }

  .player__transport-controls {
    gap: var(--am-space-1);
  }

  .player__button {
    inline-size: 44px;
    block-size: 44px;
  }

  .player__button--primary {
    inline-size: 44px;
    block-size: 44px;
  }

  .player .player__mobile-actions {
    /* 独立收集样式时父级可能先于子级加载，手机排列必须覆盖默认的右对齐。 */
    justify-content: space-around;
  }

  .player__mobile-actions :deep(.player-actions__button--mode) {
    min-inline-size: 62px;
  }

  .player__now-playing {
    position: absolute;
    z-index: var(--am-z-dialog);
    inset: 0;
    display: grid;
    grid-template-rows: auto auto minmax(var(--am-space-4), 1fr) repeat(4, auto);
    align-items: center;
    gap: var(--am-space-3);
    padding: max(var(--am-space-4), env(safe-area-inset-top)) var(--am-space-5)
      max(var(--am-space-6), env(safe-area-inset-bottom));
    overflow-y: auto;
    background: var(--am-color-background);
    color: var(--am-color-text);
    pointer-events: auto;
    transform: translateY(var(--am-player-sheet-offset, 0%));
    transition: transform var(--am-motion-slow) var(--am-ease-emphasized);
    will-change: transform;
    /* pan-down 指向下滚动（手指上划）；手指下划留给收起手势，避免原生滚动触发 pointercancel。 */
    touch-action: pan-down;
    overscroll-behavior: contain;
    cursor: grab;
  }

  .player__now-playing--scrolled {
    touch-action: pan-y;
  }

  .player__now-playing--dragging {
    transition: none;
    cursor: grabbing;
  }

  .player__now-playing-header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    min-block-size: 44px;
  }

  .player__now-playing-header button {
    justify-self: start;
  }

  .player__now-playing-copy {
    display: grid;
    align-self: start;
    gap: var(--am-space-2);
    min-inline-size: 0;
    text-align: center;
  }

  .player__now-playing-copy h2,
  .player__now-playing-copy p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .player__now-playing-copy h2 {
    font-size: var(--am-font-size-xl);
  }

  .player__now-playing-copy p {
    color: var(--am-color-text-secondary);
  }

  .player__now-playing-status {
    margin: 0;
    color: var(--am-color-text-secondary);
    font-size: var(--am-font-size-xs);
    text-align: center;
    overflow-wrap: anywhere;
  }

  .player__now-playing-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--am-space-5);
  }

  /* 操作类与子组件根类位于同一元素，使用详情层祖先覆盖后加载的默认右对齐。 */
  .player__now-playing-seek-actions,
  .player__now-playing .player__now-playing-actions {
    display: flex;
    justify-content: center;
  }

  .player__now-playing-seek-actions {
    gap: var(--am-space-5);
  }
}

@media (max-width: 340px) {
  .player__mobile-actions,
  .player__now-playing-actions {
    gap: 0;
  }

  .player__mobile-actions :deep(.player-actions__button),
  .player__now-playing-actions :deep(.player-actions__button) {
    inline-size: 44px;
    min-inline-size: 44px;
    padding-inline: 0;
  }

  .player__mobile-actions :deep(.player-actions__button--mode .app-icon),
  .player__now-playing-actions :deep(.player-actions__button--mode .app-icon) {
    display: none;
  }
}

.am-now-playing-enter-active,
.am-now-playing-leave-active {
  transition:
    transform var(--am-motion-slow) var(--am-ease-emphasized),
    opacity var(--am-motion-normal) var(--am-ease-standard);
}

.am-now-playing-enter-from,
.am-now-playing-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
  .player__button,
  .player__now-playing button,
  .player__now-playing,
  .am-now-playing-enter-active,
  .am-now-playing-leave-active {
    transition-duration: 1ms;
  }
}
</style>
