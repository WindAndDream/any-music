<script setup lang="ts">
import type {
  UiMusicSourcePickerButtonProps,
  UiMusicSourcePickerButtonEmits,
} from '@any-music/ui/catalog'
/** 桌面与手机顶栏共用同一个受控平台入口。 */
defineProps<UiMusicSourcePickerButtonProps>()
const emit = defineEmits<UiMusicSourcePickerButtonEmits>()
</script>

<template>
  <span v-if="locked" class="music-source-picker-button music-source-picker-button--locked">
    <span class="music-source-picker-button__name">{{ sourceName }}</span>
  </span>
  <button
    v-else
    class="music-source-picker-button"
    type="button"
    aria-haspopup="dialog"
    :aria-expanded="expanded"
    :aria-label="`切换音乐平台，当前：${sourceName}`"
    @click="emit('open')"
  >
    <span class="music-source-picker-button__name">{{ sourceName }}</span>
    <span class="music-source-picker-button__action" aria-hidden="true">切换</span>
  </button>
</template>

<style scoped>
.music-source-picker-button {
  display: inline-flex;
  min-inline-size: 0;
  max-inline-size: 100%;
  min-block-size: 44px;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
  font-size: var(--am-font-size-sm);
  touch-action: manipulation;
}
.music-source-picker-button__name {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 650;
}
.music-source-picker-button__action {
  flex: 0 0 auto;
  padding-inline-start: var(--am-space-2);
  border-inline-start: 1px solid var(--am-color-border);
  color: var(--am-color-primary);
  font-size: var(--am-font-size-xs);
  font-weight: 650;
}
.music-source-picker-button:hover {
  border-color: var(--am-color-primary);
  background: var(--am-color-surface-hover);
}
.music-source-picker-button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.music-source-picker-button--locked {
  cursor: default;
}
.music-source-picker-button--locked:hover {
  border-color: var(--am-color-border-strong);
  background: var(--am-color-surface);
}
.music-source-picker-button--locked .music-source-picker-button__action {
  color: var(--am-color-text-secondary);
}
</style>
