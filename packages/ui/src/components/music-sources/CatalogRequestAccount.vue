<script setup lang="ts">
import type { TrackListing } from '@any-music/core'
import { computed } from 'vue'

import AppIcon from '../AppIcon.vue'

/** 列表只显示实际请求身份，不提供修改当前平台选择的入口。 */
const props = defineProps<{ account?: TrackListing['account']; loading?: boolean }>()
const label = computed(
  () =>
    props.account?.customName ||
    props.account?.name ||
    (props.loading ? '账号加载中…' : '加载后显示账号'),
)
</script>

<template>
  <span class="catalog-request-account" :title="label" aria-label="列表请求账号">
    <AppIcon name="user" :size="16" /><span>{{ label }}</span>
  </span>
</template>

<style scoped>
.catalog-request-account {
  display: inline-flex;
  min-inline-size: 0;
  max-inline-size: 100%;
  align-items: center;
  gap: var(--am-space-2);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
.catalog-request-account > span {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.catalog-request-account :deep(svg) {
  flex-shrink: 0;
}
</style>
