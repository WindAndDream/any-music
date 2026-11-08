<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ tags: readonly string[]; label?: string; singleLine?: boolean }>()
const visible = computed(() => (props.singleLine ? props.tags : props.tags.slice(0, 2)))
</script>

<template>
  <span
    v-if="tags.length"
    class="collection-tags"
    :class="{ 'collection-tags--single-line': singleLine }"
    role="group"
    :aria-label="`${label ?? '标签'}：${tags.join('、')}`"
    :title="tags.join('、')"
  >
    <span v-for="tag in visible" :key="tag" class="collection-tags__tag" aria-hidden="true">{{
      tag
    }}</span>
    <span v-if="tags.length > visible.length" class="collection-tags__remaining" aria-hidden="true"
      >+{{ tags.length - visible.length }}</span
    >
  </span>
</template>

<style scoped>
.collection-tags {
  display: flex;
  align-items: center;
  gap: var(--am-space-1);
  min-inline-size: 0;
  max-inline-size: 100%;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.collection-tags__tag {
  flex: 0 1 auto;
  min-inline-size: 0;
  padding: var(--am-space-1) var(--am-space-2);
  overflow: hidden;
  border-radius: var(--am-radius-detail);
  background: var(--am-color-surface-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collection-tags__remaining {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}
.collection-tags--single-line {
  flex-wrap: nowrap;
  gap: var(--am-space-2);
  overflow: hidden;
}
.collection-tags--single-line .collection-tags__tag {
  flex: 0 0 auto;
  box-sizing: border-box;
  max-inline-size: 100%;
  min-block-size: 28px;
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}
</style>
