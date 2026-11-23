<script setup lang="ts">
withDefaults(
  defineProps<{ resultCount: number; totalCount: number; unit?: string; disabled?: boolean }>(),
  { unit: '首', disabled: false },
)
const emit = defineEmits<{ cancel: []; apply: [] }>()
</script>

<template>
  <div class="classic-filter-footer">
    <span role="status"
      >匹配 <strong>{{ resultCount }} / {{ totalCount }} {{ unit }}</strong></span
    >
    <div class="classic-filter-footer__actions">
      <button type="button" @click="emit('cancel')">取消</button>
      <button
        class="classic-filter-footer__apply"
        type="button"
        :disabled="disabled"
        @click="emit('apply')"
      >
        应用筛选
      </button>
    </div>
  </div>
</template>

<style scoped>
.classic-filter-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-3);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
.classic-filter-footer strong {
  font-variant-numeric: tabular-nums;
}
.classic-filter-footer__actions {
  display: flex;
  justify-content: end;
  gap: var(--am-space-2);
  margin-inline-start: auto;
}
.classic-filter-footer button {
  min-block-size: 44px;
  padding-inline: var(--am-space-4);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.classic-filter-footer button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -2px;
}
.classic-filter-footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.classic-filter-footer .classic-filter-footer__apply {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
.classic-filter-footer .classic-filter-footer__apply:focus-visible {
  outline-color: var(--am-color-on-primary);
}
@container am-bottom-sheet (max-width: 600px) {
  .classic-filter-footer {
    align-items: stretch;
    flex-direction: column;
  }
  .classic-filter-footer__actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-inline-start: 0;
  }
}
</style>
