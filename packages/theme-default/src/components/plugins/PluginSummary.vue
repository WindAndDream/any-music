<script setup lang="ts">
import type { UiPluginCenterItem } from '@any-music/ui/theme'
import { computed } from 'vue'

const props = defineProps<{ items: readonly UiPluginCenterItem[]; compact?: boolean }>()
const builtinCount = computed(() => props.items.filter((item) => item.origin === 'builtin').length)
const externalCount = computed(() => props.items.length - builtinCount.value)
</script>

<template>
  <span
    class="plugin-summary"
    :class="{ 'plugin-summary--compact': compact }"
    aria-label="插件数量"
  >
    <span class="plugin-summary__item"
      >内置 <strong>{{ builtinCount }}</strong> 个</span
    >
    <span class="plugin-summary__separator" aria-hidden="true">·</span>
    <span class="plugin-summary__item"
      >外置 <strong>{{ externalCount }}</strong> 个</span
    >
  </span>
</template>

<style scoped>
.plugin-summary {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--am-space-2);
  row-gap: var(--am-space-1);
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
  font-size: var(--am-font-size-sm);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.plugin-summary__item {
  white-space: nowrap;
}
.plugin-summary__item strong {
  font-size: var(--am-font-size-lg);
  font-weight: 750;
}
.plugin-summary__separator {
  opacity: 0.5;
}
.plugin-summary--compact {
  justify-content: flex-end;
  column-gap: var(--am-space-1);
  font-size: var(--am-font-size-xs);
}
.plugin-summary--compact .plugin-summary__item strong {
  font-size: var(--am-font-size-sm);
}
</style>
