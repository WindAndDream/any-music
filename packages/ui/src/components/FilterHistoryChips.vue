<script setup lang="ts">
defineProps<{ labels: readonly string[]; singleLine?: boolean }>()
</script>

<template>
  <span class="filter-history-chips" :class="{ 'filter-history-chips--single-line': singleLine }">
    <span v-for="(label, index) in labels" :key="index" class="filter-history-chips__label">
      {{ label }}
    </span>
  </span>
</template>

<style scoped>
.filter-history-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--am-space-1);
  min-inline-size: 0;
  font-size: var(--am-font-size-sm);
  font-weight: 650;
}
.filter-history-chips__label {
  min-inline-size: 0;
  max-inline-size: 100%;
  padding: var(--am-space-1) var(--am-space-2);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text);
  overflow-wrap: anywhere;
}
.filter-history-chips--single-line {
  flex-wrap: nowrap;
  overflow: hidden;
}
.filter-history-chips--single-line .filter-history-chips__label {
  flex: none;
  max-inline-size: none;
  white-space: nowrap;
}
</style>
