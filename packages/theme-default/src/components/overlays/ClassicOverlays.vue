<script setup lang="ts">
import type { ActiveConfirmationRequest } from '@any-music/ui'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, onScopeDispose } from 'vue'

import OrdinaryOverlays from './OrdinaryOverlays.vue'

/** Global ordinary feedback only. Native installation/consent/recovery stays in the host. */
const props = defineProps<{ feature: UiThemeFeatureMap['overlays'] }>()
let active = true
onScopeDispose(() => (active = false))
const request = computed<ActiveConfirmationRequest | undefined>(() => {
  const value = props.feature.state.active
  return value?.kind === 'confirmation'
    ? { ...value, cancelLabel: value.cancelLabel ?? '取消', tone: value.tone ?? 'default' }
    : undefined
})
function confirm(id: number): void {
  if (active && request.value?.id === id) void props.feature.actions.confirm(id)
}
function cancel(id: number): void {
  if (active && request.value?.id === id) props.feature.actions.close(id)
}
</script>

<template>
  <OrdinaryOverlays
    :request="request"
    :notice="feature.state.notice ?? undefined"
    @confirm="confirm"
    @cancel="cancel"
    @notice-pause-change="feature.actions.setNoticePaused"
  />
</template>
