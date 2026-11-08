<script setup lang="ts">
import { ConfirmationDialog, AppToast } from '@any-music/ui'
import type { ActiveConfirmationRequest } from '@any-music/ui'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, onScopeDispose } from 'vue'
const props = defineProps<{ feature: UiThemeFeatureMap['overlays'] }>()
let active = true
onScopeDispose(() => {
  active = false
})
const request = computed<ActiveConfirmationRequest | undefined>(() => {
  const value = props.feature.state.active
  return value?.kind === 'confirmation'
    ? { ...value, cancelLabel: value.cancelLabel ?? '取消', tone: value.tone ?? 'default' }
    : undefined
})
const handlers = computed(() => {
  const id = request.value?.id
  return {
    confirm: () => {
      if (active && id !== undefined && request.value?.id === id)
        void props.feature.actions.confirm(id)
    },
    cancel: () => {
      if (active && id !== undefined && request.value?.id === id) props.feature.actions.close(id)
    },
  }
})
</script>
<template>
  <ConfirmationDialog :key="request?.id" :request="request" v-on="handlers" /><AppToast
    :message="feature.state.notice?.message"
    :tone="feature.state.notice?.tone"
    @pause-change="feature.actions.setNoticePaused"
  /><button
    v-if="feature.state.notice"
    class="studio-notice-dismiss"
    type="button"
    aria-label="关闭通知"
    @click="feature.actions.dismissNotice"
  >
    关闭通知
  </button>
</template>
