<script setup lang="ts">
import MusicSourceWorkbench from '@any-music/music-workbench/components/music-sources/MusicSourceWorkbench.vue'
import { AppToast } from '@any-music/ui'

import { useProductStorageNotice } from './platform/use-product-storage-notice'

// 正式 Userscript 根组件只组合产品入口；跨功能状态与副作用由 feature composable 持有。
const storageNotice = useProductStorageNotice()
</script>

<template>
  <MusicSourceWorkbench />
  <AppToast :message="storageNotice.message.value" tone="error" />
</template>
