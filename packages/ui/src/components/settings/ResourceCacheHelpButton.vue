<script setup lang="ts">
import { onScopeDispose, shallowRef, watch } from 'vue'

import AppIcon from '../AppIcon.vue'
import ResourceCacheHelpDialog from './ResourceCacheHelpDialog.vue'

defineProps<{
  overlayTarget?: HTMLElement | null
  suspended?: boolean
  canChooseDirectory?: boolean
  description?: string
}>()
const emit = defineEmits<{ detailOpenChange: [open: boolean] }>()
const helpOpen = shallowRef(false)
watch(helpOpen, (open) => emit('detailOpenChange', open), { flush: 'sync' })
onScopeDispose(() => emit('detailOpenChange', false))
</script>

<template>
  <button
    class="settings-form__button resource-cache-help"
    type="button"
    aria-haspopup="dialog"
    data-am-focus-key="settings:cache:help"
    @click="helpOpen = true"
  >
    <AppIcon name="info" :size="16" />缓存介绍
  </button>
  <Teleport :to="overlayTarget ?? 'body'" :disabled="!overlayTarget">
    <ResourceCacheHelpDialog
      :open="helpOpen"
      :suspended="suspended"
      :can-choose-directory="canChooseDirectory"
      :description="description"
      @close="helpOpen = false"
    />
  </Teleport>
</template>

<style scoped>
.resource-cache-help {
  white-space: nowrap;
}
</style>
