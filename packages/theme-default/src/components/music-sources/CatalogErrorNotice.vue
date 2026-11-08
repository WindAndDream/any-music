<script setup lang="ts">
import type { UiCatalogErrorNoticeProps, UiCatalogErrorNoticeEmits } from '@any-music/ui/catalog'
import {
  getCatalogDrawerDisconnectedMessage,
  getCatalogDrawerErrorMessage,
  hasCatalogDrawerError,
  isCatalogDrawerDisconnected,
} from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { computed } from 'vue'

// 来源断开使用静态状态提示；真实故障才提供可点击的错误摘要。
const props = defineProps<UiCatalogErrorNoticeProps>()
const emit = defineEmits<UiCatalogErrorNoticeEmits>()
const isDisconnected = computed(() => isCatalogDrawerDisconnected(props.drawer))
const statusMessage = computed(() =>
  isDisconnected.value
    ? getCatalogDrawerDisconnectedMessage(props.drawer)
    : hasCatalogDrawerError(props.drawer)
      ? getCatalogDrawerErrorMessage(props.drawer)
      : '',
)
</script>

<template>
  <div
    v-if="isDisconnected"
    class="catalog-drawer__message catalog-drawer__message--disconnected"
    role="status"
  >
    <AppIcon name="pause" :size="16" />
    <span>{{ statusMessage }}</span>
  </div>
  <div v-else-if="statusMessage" class="catalog-drawer__message" role="alert">
    <button
      type="button"
      aria-haspopup="dialog"
      title="点击查看错误详情"
      @click="emit('showError', props.drawer.id)"
    >
      <AppIcon name="warning" :size="15" />
      <span>{{ statusMessage }}</span>
    </button>
  </div>
</template>
