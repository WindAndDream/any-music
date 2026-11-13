<script setup lang="ts">
import type { UiCatalogContextTitleProps, UiCatalogContextTitleEmits } from '@any-music/ui/catalog'
import { useCatalogContextTitle } from '@any-music/ui/catalog'
import { computed, useTemplateRef } from 'vue'

/** 收窄时保留平台与原始输入；仍被省略时才提供原生按钮和全文入口。 */
const props = defineProps<UiCatalogContextTitleProps>()
const emit = defineEmits<UiCatalogContextTitleEmits>()
const availableElement = useTemplateRef<HTMLElement>('availableElement')
const titleElement = useTemplateRef<HTMLElement>('titleElement')
const compactTitleElement = useTemplateRef<HTMLElement>('compactTitleElement')
const compactTitle = computed(() =>
  props.input ? `${props.pluginName} · ${props.input}` : props.title,
)
const { displayText, isTruncated } = useCatalogContextTitle({
  title: () => props.title,
  compactTitle,
  availableElement,
  titleElement,
  compactTitleElement,
})
</script>

<template>
  <div class="catalog-context-title">
    <span ref="availableElement" class="catalog-context-title__measurements" aria-hidden="true">
      <strong ref="titleElement" class="catalog-context-title__measure">{{ props.title }}</strong>
      <strong ref="compactTitleElement" class="catalog-context-title__measure">{{
        compactTitle
      }}</strong>
    </span>
    <button
      v-if="isTruncated"
      class="catalog-context-title__button"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="props.expanded"
      :aria-label="`查看音乐列表完整信息：${props.title}`"
      @click="emit('showDetails')"
    >
      <strong class="catalog-context-title__text">{{ displayText }}</strong>
    </button>
    <strong v-else class="catalog-context-title__text">{{ displayText }}</strong>
  </div>
</template>

<style scoped>
.catalog-context-title {
  position: relative;
  display: flex;
  box-sizing: border-box;
  inline-size: 100%;
  min-inline-size: 0;
  min-block-size: 44px;
  align-items: center;
  color: var(--am-color-text);
}
.catalog-context-title__text,
.catalog-context-title__measure {
  font-size: var(--am-font-size-md);
  font-weight: 700;
  white-space: nowrap;
}
.catalog-context-title__text {
  display: block;
  box-sizing: border-box;
  min-inline-size: 0;
  inline-size: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.catalog-context-title > .catalog-context-title__text {
  padding-inline: var(--am-space-3);
}
/* 裁切不可见的测量区，避免长词/链接扩大产品滚动范围或重复进入无障碍树。 */
.catalog-context-title__measurements {
  position: absolute;
  inset-block: 0;
  inset-inline: var(--am-space-3);
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
}
.catalog-context-title__measure {
  position: absolute;
  inline-size: max-content;
}
.catalog-context-title .catalog-context-title__button {
  inline-size: 100%;
  min-inline-size: 0;
  min-block-size: 44px;
  padding: 0 var(--am-space-3);
  box-sizing: border-box;
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: start;
  touch-action: manipulation;
}
.catalog-context-title .catalog-context-title__button:hover {
  background: var(--am-color-surface-hover);
}
.catalog-context-title__button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
