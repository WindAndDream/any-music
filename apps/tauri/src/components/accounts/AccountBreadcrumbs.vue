<script setup lang="ts">
import type { AccountPathItem } from '../../features/accounts/use-account-settings'

defineProps<{ items: readonly AccountPathItem[] }>()
const emit = defineEmits<{ navigate: [id: AccountPathItem['id']] }>()
</script>
<template>
  <nav class="account-path" aria-label="账号管理路径" tabindex="0">
    <ol>
      <li v-for="(item, index) in items" :key="item.id">
        <span v-if="index" class="account-path__separator" aria-hidden="true">/</span>
        <span v-if="index === items.length - 1" aria-current="page">{{ item.label }}</span>
        <button v-else type="button" @click="emit('navigate', item.id)">{{ item.label }}</button>
      </li>
    </ol>
  </nav>
</template>
<style scoped>
.account-path {
  min-inline-size: 0;
  max-inline-size: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  padding-block: var(--am-space-2);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.account-path::-webkit-scrollbar {
  display: none;
}
.account-path ol,
.account-path li {
  display: flex;
  align-items: center;
  gap: var(--am-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
  white-space: nowrap;
}
.account-path li {
  flex: 0 0 auto;
}
.account-path button {
  border: 0;
  padding: var(--am-space-2) var(--am-space-1);
  border-radius: var(--am-radius-detail);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.account-path [aria-current] {
  color: var(--am-color-text);
  font-weight: 650;
}
.account-path button:hover {
  color: var(--am-color-primary);
  background: var(--am-color-surface-hover);
}
.account-path:focus-visible,
.account-path button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -2px;
}
.account-path__separator {
  opacity: 0.5;
}
</style>
