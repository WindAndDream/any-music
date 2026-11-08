<script setup lang="ts">
import type { UiThemeAvailability, UiThemeStatus } from '@any-music/ui/theme'

defineProps<{ availability: UiThemeAvailability; status: UiThemeStatus }>()
</script>

<template>
  <p v-if="availability.status !== 'available'" role="status">{{ availability.reason }}</p>
  <p v-if="status.status === 'error' || status.status === 'invalid'" role="alert">
    {{ status.error.message }}
  </p>
  <div v-else-if="status.status === 'partial'" role="status">
    已保留加载的内容。
    <p v-for="(error, index) in status.errors" :key="index">{{ error.message }}</p>
  </div>
  <p v-else-if="status.status === 'loading'" role="status">正在加载…</p>
  <p v-else-if="status.status === 'empty'" role="status">暂无内容。</p>
  <p v-else-if="status.status === 'idle'" role="status">等待操作。</p>
</template>
