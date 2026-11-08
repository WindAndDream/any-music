<script setup lang="ts">
import type { AppIconName } from '../app-icon'
import AppIcon from '../AppIcon.vue'

/** 搜索列表与待听共用空状态表面；内容作为一组居中，标题可接收集合切页后的焦点。 */
defineProps<{
  icon: AppIconName
  title: string
  focusTitle?: boolean
}>()

defineSlots<{ default: () => unknown }>()
</script>

<template>
  <div class="music-list-empty">
    <div class="music-list-empty__content">
      <span class="music-list-empty__icon" aria-hidden="true">
        <AppIcon :name="icon" :size="26" />
      </span>
      <h3
        class="music-list-empty__title"
        :tabindex="focusTitle ? -1 : undefined"
        :data-collection-focus="focusTitle ? '' : undefined"
      >
        {{ title }}
      </h3>
      <p class="music-list-empty__description"><slot /></p>
    </div>
  </div>
</template>

<style scoped>
.music-list-empty {
  display: grid;
  flex: 1 0 auto;
  min-inline-size: 0;
  min-block-size: 220px;
  place-items: center;
  padding: var(--am-space-7) var(--am-space-4);
  border: 1px dashed var(--am-color-border-strong);
  border-radius: var(--am-radius-panel);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  text-align: center;
}
.music-list-empty__content {
  display: grid;
  min-inline-size: 0;
  max-inline-size: 100%;
  justify-items: center;
  gap: var(--am-space-2);
}
.music-list-empty__icon {
  display: grid;
  inline-size: 52px;
  block-size: 52px;
  place-items: center;
  border-radius: var(--am-radius-sm);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
}
.music-list-empty__title,
.music-list-empty__description {
  margin: 0;
}
.music-list-empty__title {
  font-size: var(--am-font-size-md);
  font-weight: 700;
}
.music-list-empty__description {
  min-inline-size: 0;
  max-inline-size: 100%;
  overflow-wrap: anywhere;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
  line-height: 1.7;
}
@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .music-list-empty__icon :deep(.app-icon) {
    transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
  }
  .music-list-empty__icon:hover :deep(.app-icon) {
    transform: translateY(-2px) rotate(-8deg) scale(1.06);
  }
}
</style>
