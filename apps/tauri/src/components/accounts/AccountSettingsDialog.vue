<script setup lang="ts">
import { AppDialog, BottomSheet } from '@any-music/ui'
import DialogPages from '@any-music/ui/components/DialogPages.vue'
defineProps<{
  open: boolean
  title: string
  description?: string
  isMobileLayout?: boolean
  overlayTarget?: HTMLElement | null
  suspended?: boolean
  backAction?: () => void
  page?: string
  returning?: boolean
}>()
const emit = defineEmits<{ close: [] }>()
</script>
<template>
  <Teleport :to="overlayTarget ?? 'body'" :disabled="!overlayTarget">
    <component
      :is="isMobileLayout ? BottomSheet : AppDialog"
      class="account-settings-dialog"
      :open="open"
      :title="title"
      :description="description"
      :suspended="suspended"
      :back-action="backAction"
      size="compact"
      @close="emit('close')"
    >
      <div class="settings-form native-settings account-settings-dialog__content">
        <DialogPages
          :page="page ?? 'root'"
          :returning="returning"
          focus-selector="button:not(:disabled), input:not(:disabled)"
          ><slot
        /></DialogPages>
      </div>
      <template v-if="$slots.footer" #footer>
        <div class="native-settings account-settings-dialog__actions"><slot name="footer" /></div>
      </template>
    </component>
  </Teleport>
</template>
<style scoped>
.account-settings-dialog__content {
  gap: var(--am-space-3);
}
.account-settings-dialog__content :deep(.settings-form) {
  gap: var(--am-space-4);
}
.account-settings-dialog__content :deep(.native-settings__entry) {
  min-block-size: 64px;
  padding: var(--am-space-3);
}
.account-settings-dialog__actions :deep(button) {
  inline-size: fit-content;
  max-inline-size: 100%;
  flex: 0 0 auto;
}
.account-settings-dialog__actions :deep(.settings-form__footer) {
  justify-content: flex-end;
  gap: var(--am-space-2);
}
.account-settings-dialog :deep(.bottom-sheet__panel--compact) {
  min-block-size: 0;
  max-block-size: 85dvh;
}
.account-settings-dialog :deep(.bottom-sheet__footer) {
  padding-block-end: max(var(--am-space-4), env(safe-area-inset-bottom));
}
</style>
