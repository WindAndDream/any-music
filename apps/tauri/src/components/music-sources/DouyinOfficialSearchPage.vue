<script setup lang="ts">
import { useTemplateRef } from 'vue'

import { useAccountPage } from '../../platform/account-page'
import { useDouyinOfficialSearch } from '../../platform/use-douyin-official-search'

const props = defineProps<{ accountId?: string; query: string; suspended: boolean }>()
const viewport = useTemplateRef<HTMLElement>('viewport')
const accountPage = useAccountPage()
const { error, ready, start } = useDouyinOfficialSearch(viewport, {
  get accountId() {
    return props.accountId
  },
  get query() {
    return props.query
  },
  get suspended() {
    return props.suspended || Boolean(accountPage.current.value)
  },
})
</script>

<template>
  <section
    ref="viewport"
    class="douyin-official-search"
    aria-label="抖音官方搜索结果"
    :aria-busy="!ready && !error"
  >
    <template v-if="error">
      <p role="alert">{{ error.message }}</p>
      <button v-if="accountId" type="button" @click="start">重试</button>
    </template>
    <p v-else-if="!ready" role="status">正在加载抖音官方搜索…</p>
  </section>
</template>

<style scoped>
.douyin-official-search button {
  display: inline-flex;
  align-items: center;
  gap: var(--am-space-2);
  padding: var(--am-space-2) var(--am-space-3);
  color: var(--am-color-text);
  background: var(--am-color-surface-subtle);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  cursor: pointer;
}
.douyin-official-search {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--am-space-2);
  min-block-size: 180px;
  block-size: min(56dvh, 900px);
  background: var(--am-color-surface-subtle);
}
</style>
