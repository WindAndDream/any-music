<script setup lang="ts">
import AppIcon from './AppIcon.vue'

/** Controlled browsing controls shared by associated music and playlist collections. */
defineProps<{
  subject: '音乐' | '歌单'
  selectedCount: number
  visibleCount: number
  allSelected: boolean
  filterCount: number
  mobileLayout?: boolean
  disabled?: boolean
}>()
defineEmits<{ display: []; filter: []; toggleAll: [] }>()
</script>

<template>
  <header
    class="collection-selection-toolbar"
    :class="{ 'collection-selection-toolbar--mobile': mobileLayout }"
  >
    <p role="status">已选 {{ selectedCount }} 个</p>
    <button
      type="button"
      class="collection-selection-toolbar__display"
      :aria-label="`关联${subject}展示方式`"
      title="展示方式"
      aria-haspopup="dialog"
      :disabled="disabled"
      @click="$emit('display')"
    >
      <AppIcon name="list" :size="18" /><span>展示方式</span>
    </button>
    <button
      type="button"
      :aria-label="`关联${subject}筛选器`"
      aria-haspopup="dialog"
      :disabled="disabled"
      @click="$emit('filter')"
    >
      <AppIcon name="filter" :size="18" />筛选器<span
        v-if="filterCount"
        class="collection-selection-toolbar__count"
        >{{ filterCount }}</span
      >
    </button>
    <button
      type="button"
      class="collection-selection-toolbar__all"
      :aria-label="`全选当前${subject}`"
      :aria-pressed="allSelected"
      :disabled="disabled || !visibleCount"
      @click="$emit('toggleAll')"
    >
      <span class="collection-selection-toolbar__check" aria-hidden="true"
        ><AppIcon v-if="allSelected" name="check" :size="12" /></span
      >全选
    </button>
  </header>
</template>

<style scoped>
.collection-selection-toolbar {
  container: am-collection-selection / inline-size;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--am-space-2);
}
.collection-selection-toolbar p {
  flex: 1 1 auto;
  min-inline-size: 0;
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.collection-selection-toolbar button {
  display: inline-flex;
  box-sizing: border-box;
  min-block-size: 36px;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-4);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: 700 var(--am-font-size-xs) var(--am-font-family);
  white-space: nowrap;
  cursor: pointer;
}
.collection-selection-toolbar button:hover:not(:disabled) {
  background: var(--am-color-surface-hover);
}
.collection-selection-toolbar button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.collection-selection-toolbar button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.collection-selection-toolbar .collection-selection-toolbar__all,
.collection-selection-toolbar .collection-selection-toolbar__all:hover:not(:disabled) {
  background: var(--am-color-surface-subtle);
}
.collection-selection-toolbar__check {
  display: grid;
  flex: 0 0 16px;
  box-sizing: border-box;
  inline-size: 16px;
  block-size: 16px;
  place-items: center;
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-detail);
}
.collection-selection-toolbar .collection-selection-toolbar__all[aria-pressed='true'],
.collection-selection-toolbar
  .collection-selection-toolbar__all[aria-pressed='true']:hover:not(:disabled) {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
.collection-selection-toolbar__all[aria-pressed='true'] .collection-selection-toolbar__check {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
.collection-selection-toolbar__count {
  display: grid;
  min-inline-size: 20px;
  block-size: 20px;
  place-items: center;
  padding-inline: 4px;
  border-radius: var(--am-radius-detail);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  font-size: 10px;
}
.collection-selection-toolbar--mobile .collection-selection-toolbar__display {
  inline-size: 36px;
  min-inline-size: 36px;
  padding-inline: 0;
}
.collection-selection-toolbar--mobile .collection-selection-toolbar__display span {
  display: none;
}
@container am-collection-selection (max-width: 600px) {
  .collection-selection-toolbar button {
    padding-inline: var(--am-space-2);
  }
  .collection-selection-toolbar .collection-selection-toolbar__display {
    inline-size: 36px;
    min-inline-size: 36px;
    padding-inline: 0;
  }
  .collection-selection-toolbar__display span {
    display: none;
  }
}
@container am-dialog (max-width: 320px) {
  .collection-selection-toolbar {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .collection-selection-toolbar__display {
    justify-self: end;
  }
}
</style>
