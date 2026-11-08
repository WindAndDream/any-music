<script setup lang="ts">
import { AppToast, ConfirmationDialog } from '@any-music/ui'
import type { OrdinaryOverlaysProps, OrdinaryOverlaysEmits } from '@any-music/ui/theme'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

const props = defineProps<OrdinaryOverlaysProps>()
const emit = defineEmits<OrdinaryOverlaysEmits>()
let active = true
onScopeDispose(() => (active = false))
const requestKey = shallowRef(props.request?.id)
watch(
  () => props.request?.id,
  (id) => {
    if (id !== undefined) requestKey.value = id
  },
  { flush: 'sync' },
)
// Each rendered handler captures its request. Retained events cannot accept a replacement.
const handlers = computed(() => {
  const id = props.request?.id
  return {
    confirm: () => {
      if (active && id !== undefined && props.request?.id === id) emit('confirm', id)
    },
    cancel: () => {
      if (active && id !== undefined && props.request?.id === id) emit('cancel', id)
    },
  }
})
</script>

<template>
  <ConfirmationDialog :key="requestKey" :request="request" v-on="handlers" />
  <AppToast
    :message="notice?.message"
    :tone="notice?.tone"
    :icon="notice?.icon"
    :notice-id="notice?.id"
    @pause-change="emit('noticePauseChange', $event)"
  />
</template>
