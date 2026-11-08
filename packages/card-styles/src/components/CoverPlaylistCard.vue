<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import CollectionTagSummary from '@any-music/ui/components/CollectionTagSummary.vue'
import RemoteImage from '@any-music/ui/components/music-sources/RemoteImage.vue'
defineProps<{
  id: string
  name: string
  tags?: readonly string[]
  coverUrl?: string
  count: number
  index?: number
  selected?: boolean
  selectable?: boolean
  /** Pickers reuse the library artwork without offering details or reordering. */
  selectionOnly?: boolean
  disabled?: boolean
  readonly?: boolean
}>()
defineEmits<{
  open: []
  actions: []
  select: []
  press: [event: PointerEvent]
  shift: [direction: -1 | 1]
  cancelDrag: []
}>()
</script>
<template>
  <div
    class="am-cover-playlist"
    :class="{
      'am-cover-playlist--selectable': selectable,
      'am-cover-playlist--selection-only': selectionOnly,
      'am-cover-playlist--readonly': readonly,
    }"
  >
    <component
      :is="readonly ? 'div' : 'button'"
      class="am-cover-playlist__art"
      type="button"
      :data-queue-handle="selectionOnly || readonly ? undefined : ''"
      :disabled="disabled"
      :aria-label="
        selectionOnly
          ? `选择歌单 ${name}，${count} 首歌曲`
          : `打开歌单 ${name}，${count} 首歌曲；长按拖动排序，方向键调整顺序`
      "
      :aria-pressed="selectable ? Boolean(selected) : undefined"
      @click.stop="!readonly && (selectable ? $emit('select') : $emit('open'))"
      @pointerdown="!readonly && !selectionOnly && $emit('press', $event)"
      @contextmenu.prevent
      @dragstart.prevent
      @keydown.up="!readonly && !selectionOnly && ($event.preventDefault(), $emit('shift', -1))"
      @keydown.left="!readonly && !selectionOnly && ($event.preventDefault(), $emit('shift', -1))"
      @keydown.down="!readonly && !selectionOnly && ($event.preventDefault(), $emit('shift', 1))"
      @keydown.right="!readonly && !selectionOnly && ($event.preventDefault(), $emit('shift', 1))"
      @keydown.esc="!readonly && $emit('cancelDrag')"
    >
      <RemoteImage v-if="coverUrl" :src="coverUrl" :alt="`${name}封面`" /><AppIcon
        v-else
        name="playlist"
        :size="54"
      />
      <span class="am-cover-playlist__count" aria-hidden="true">
        <span class="am-cover-playlist__count-text"
          >{{ count }}<span class="am-cover-playlist__count-unit"> 首歌曲</span></span
        >
      </span>
    </component>
    <div class="am-cover-playlist__body">
      <div>
        <component
          :is="readonly ? 'span' : 'button'"
          class="am-cover-playlist__name"
          type="button"
          :disabled="disabled"
          :data-collection-entry="id"
          :title="name"
          @click.stop="!readonly && (selectable ? $emit('select') : $emit('open'))"
        >
          {{ name }}
        </component>
        <p class="am-cover-playlist__track-count">共 {{ count }} 首歌曲</p>
        <CollectionTagSummary
          class="am-cover-playlist__tags"
          :tags="tags ?? []"
          label="歌单标签"
          single-line
        />
      </div>
      <!-- Preserve the library action slot when pickers hide editing controls. -->
      <div class="am-cover-playlist__controls">
        <button
          v-if="!selectionOnly && !readonly"
          class="am-cover-playlist__more"
          type="button"
          :aria-label="`查看 ${name} 的详细信息`"
          aria-haspopup="dialog"
          @click.stop="$emit('actions')"
        >
          <AppIcon name="more" :size="20" />
        </button>
      </div>
    </div>
    <label v-if="selectable && !readonly" class="am-cover-playlist__select" @click.stop
      ><input
        type="checkbox"
        :disabled="disabled"
        :checked="selected"
        :aria-label="`选择歌单 ${name}`"
        @change="$emit('select')"
    /></label>
  </div>
</template>
<style scoped>
.am-cover-playlist {
  --am-playlist-inline-count-display: none;
  --am-playlist-cover-count-display: block;
  position: relative;
  inline-size: 100%;
  min-inline-size: 0;
  color: var(--am-color-text);
}
.am-cover-playlist--readonly :is(.am-cover-playlist__art, .am-cover-playlist__name) {
  cursor: default;
}
button {
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.am-cover-playlist__art {
  /* Count scrolling measures the artwork, including narrow single-column thumbnails. */
  container-type: inline-size;
  position: relative;
  display: grid;
  place-items: center;
  inline-size: 100%;
  aspect-ratio: 8 / 5;
  max-block-size: var(--am-track-card-artwork-max-height, 200px);
  overflow: hidden;
  padding: 0;
  border-radius: var(--am-radius-artwork, 8px);
  background: linear-gradient(
    135deg,
    var(--am-color-primary-container),
    var(--am-color-surface-subtle)
  );
  color: var(--am-color-primary);
  touch-action: pan-y;
  user-select: none;
  -webkit-touch-callout: none;
}
.am-cover-playlist__art :deep(img) {
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
  transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
}
.am-cover-playlist__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  box-sizing: border-box;
  gap: var(--am-space-2);
  padding: var(--am-space-3) var(--am-space-1) 0;
}
.am-cover-playlist__body > div {
  min-inline-size: 0;
}
.am-cover-playlist__name {
  display: block;
  max-inline-size: 100%;
  padding: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: transparent;
  text-align: start;
  font-weight: 750;
  font-size: var(--am-font-size-lg);
  line-height: 1.5;
}
.am-cover-playlist__count {
  --am-playlist-count-inset: var(--am-space-2);
  --am-playlist-count-padding: var(--am-space-2);
  position: absolute;
  display: var(--am-playlist-cover-count-display);
  inset-block-end: var(--am-playlist-count-inset);
  inset-inline-end: var(--am-playlist-count-inset);
  box-sizing: border-box;
  inline-size: max-content;
  max-inline-size: calc(100% - 2 * var(--am-playlist-count-inset));
  overflow: hidden;
  padding: 2px var(--am-playlist-count-padding);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-media-caption);
  color: var(--am-color-on-media-caption);
  box-shadow: 0 2px 8px rgb(0 0 0 / 24%);
  font-size: var(--am-font-size-xs);
  font-weight: 650;
  line-height: 1.4;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--am-motion-fast) var(--am-ease-standard);
}
.am-cover-playlist__count-text {
  display: block;
  inline-size: max-content;
  min-inline-size: 100%;
}
/* Restored pointer focus must not keep the badge visible after leaving the card. */
.am-cover-playlist:has(:focus-visible) .am-cover-playlist__count {
  opacity: 1;
}
@media (hover: hover) and (pointer: fine) {
  .am-cover-playlist:hover .am-cover-playlist__count {
    opacity: 1;
  }
}
.am-cover-playlist__track-count {
  display: var(--am-playlist-inline-count-display);
  margin: var(--am-space-1) 0 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  line-height: 1.5;
}
@media (max-width: 768px), (hover: none), (pointer: coarse) {
  .am-cover-playlist {
    --am-playlist-inline-count-display: block;
    --am-playlist-cover-count-display: none;
  }
}
.am-cover-playlist__more {
  display: grid;
  place-items: center;
  inline-size: 36px;
  block-size: 36px;
  padding: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  transition:
    transform var(--am-motion-normal) var(--am-ease-emphasized),
    background-color var(--am-motion-fast) var(--am-ease-standard);
}
.am-cover-playlist__controls {
  display: flex;
  min-inline-size: 36px;
  min-block-size: 36px;
  align-items: center;
  align-self: start;
}
.am-cover-playlist__more:hover {
  background: var(--am-color-surface-hover);
}
.am-cover-playlist__select {
  /* Selection overlays the cover without changing the title or menu's layout. */
  position: absolute;
  inset-block-start: 0;
  inset-inline-end: 0;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  inline-size: 44px;
  block-size: 44px;
  box-sizing: border-box;
  padding: 6px;
  border-radius: var(--am-radius-control);
  background: transparent;
  cursor: pointer;
}
input {
  inline-size: 18px;
  block-size: 18px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--am-color-primary);
}
button:focus-visible,
.am-cover-playlist__select:has(input:focus-visible) {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.am-cover-playlist__select input:focus-visible {
  outline: 0;
}
.am-cover-playlist__tags {
  margin-block-start: var(--am-space-1);
}
@container am-track-list (max-width: 600px) {
  .am-cover-playlist {
    --am-playlist-inline-count-display: block;
    --am-playlist-cover-count-display: none;
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    align-items: center;
    gap: var(--am-space-3);
    min-block-size: 72px;
  }
  .am-cover-playlist__art {
    aspect-ratio: 1;
  }
  .am-cover-playlist__art > .app-icon {
    inline-size: 32px;
    block-size: 32px;
  }
  .am-cover-playlist__body {
    padding: 0;
  }
  .am-cover-playlist__controls {
    /* Reserve both touch targets so opening selection moves only the menu, not the row. */
    min-inline-size: 44px;
    min-block-size: 88px;
    align-self: stretch;
    align-items: center;
  }
  .am-cover-playlist__more {
    inline-size: 44px;
    block-size: 44px;
  }
  .am-cover-playlist--selectable .am-cover-playlist__more {
    transform: translateY(-22px);
  }
  .am-cover-playlist__select {
    inset-block-start: auto;
    inset-block-end: 0;
    align-items: center;
    justify-content: center;
    animation: am-playlist-selection-enter var(--am-motion-fast) var(--am-ease-standard)
      var(--am-motion-normal) both;
  }
  .am-cover-playlist__name {
    font-size: var(--am-font-size-md);
  }
  .am-cover-playlist__count {
    --am-playlist-count-inset: 0px;
    --am-playlist-count-padding: 2px;
    inset: auto 0 0;
    inline-size: 100%;
    text-align: center;
  }
  .am-cover-playlist__count-unit {
    display: none;
  }
}
@keyframes am-playlist-selection-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
/* Match song tiles when the user explicitly chooses two compact phone columns. */
@container am-track-card (max-width: 260px) {
  .am-cover-playlist {
    display: block;
  }
  .am-cover-playlist__art {
    aspect-ratio: 1;
  }
  .am-cover-playlist__body {
    padding-block-start: var(--am-space-2);
  }
}
@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
  .am-cover-playlist:hover .am-cover-playlist__art :deep(img) {
    transform: scale(1.055);
  }
}
@media (prefers-reduced-motion: no-preference) {
  .am-cover-playlist:hover .am-cover-playlist__count-text,
  .am-cover-playlist:has(:focus-visible) .am-cover-playlist__count-text {
    animation: am-playlist-count-scroll 4s ease-in-out infinite alternate;
  }
}
@keyframes am-playlist-count-scroll {
  0%,
  20% {
    transform: translateX(0);
  }
  80%,
  100% {
    /* Fitting counts stay still; overflowing text travels exactly to its final digit. */
    transform: translateX(
      min(
        0px,
        calc(
          100cqi - 2 * var(--am-playlist-count-inset) - 2 * var(--am-playlist-count-padding) - 100%
        )
      )
    );
  }
}
@media (prefers-reduced-motion: reduce) {
  .am-cover-playlist__select {
    animation: none;
  }
  .am-cover-playlist__art :deep(img),
  .am-cover-playlist__count,
  .am-cover-playlist__more {
    transition: none;
  }
}
</style>
