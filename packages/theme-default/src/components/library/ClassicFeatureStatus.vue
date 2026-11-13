<script setup lang="ts">
import type { UiThemeAvailability, UiThemeStatus } from '@any-music/ui/theme'

defineProps<{ availability: UiThemeAvailability; status: UiThemeStatus }>()
</script>

<template>
  <p v-if="availability.status !== 'available'" role="status">{{ availability.reason }}</p>
  <p v-if="status.status === 'loading'" role="status">正在加载…</p>
  <p v-if="status.status === 'error' || status.status === 'invalid'" role="alert">
    {{ status.error.message }}
  </p>
  <ul v-if="status.status === 'partial'" role="alert">
    <li v-for="(error, index) in status.errors" :key="index">{{ error.message }}</li>
  </ul>
</template>
