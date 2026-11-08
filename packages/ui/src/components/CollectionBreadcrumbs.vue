<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{ rootLabel: string; collectionLabel: string; currentName?: string }>()
const emit = defineEmits<{ back: [] }>()
</script>

<template>
  <nav class="collection-breadcrumbs" :aria-label="`${rootLabel}浏览路径`">
    <button
      v-if="currentName !== undefined"
      class="collection-breadcrumbs__back"
      type="button"
      :aria-label="`返回${collectionLabel}`"
      @click="emit('back')"
    >
      <AppIcon name="arrow-left" :size="18" />
    </button>
    <ol>
      <li>
        <span>{{ rootLabel }}</span>
      </li>
      <li>
        <AppIcon name="arrow-right" :size="12" />
        <button v-if="currentName !== undefined" type="button" @click="emit('back')">
          {{ collectionLabel }}
        </button>
        <span v-else aria-current="page">{{ collectionLabel }}</span>
      </li>
      <li v-if="currentName !== undefined" class="collection-breadcrumbs__current">
        <AppIcon name="arrow-right" :size="12" />
        <strong aria-current="page" :title="currentName">{{ currentName }}</strong>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.collection-breadcrumbs {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-2);
  margin-block-end: var(--am-space-3);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.collection-breadcrumbs ol,
.collection-breadcrumbs li {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-2);
}
.collection-breadcrumbs ol {
  flex: 1;
  margin: 0;
  padding: 0;
  list-style: none;
}
.collection-breadcrumbs li {
  flex: 0 0 auto;
}
.collection-breadcrumbs li.collection-breadcrumbs__current {
  flex: 1;
}
.collection-breadcrumbs__current strong {
  overflow: hidden;
  color: var(--am-color-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collection-breadcrumbs button {
  display: inline-flex;
  min-block-size: 44px;
  align-items: center;
  justify-content: center;
  padding-inline: var(--am-space-2);
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
}
.collection-breadcrumbs .collection-breadcrumbs__back {
  inline-size: 44px;
  flex: 0 0 auto;
  background: var(--am-color-surface);
  color: var(--am-color-text);
}
.collection-breadcrumbs button:is(:hover, :focus-visible) {
  background: var(--am-color-surface-hover);
  color: var(--am-color-primary);
}
.collection-breadcrumbs button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.collection-breadcrumbs .app-icon {
  flex: 0 0 auto;
}
</style>
