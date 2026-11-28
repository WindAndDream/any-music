<script setup lang="ts">
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import BottomSheet from '@any-music/ui/components/BottomSheet.vue'
import FilterHistoryChips from '@any-music/ui/components/FilterHistoryChips.vue'
import { nextTick, provide, shallowRef, watch } from 'vue'

import { filterDialogKey, type FilterDialogRequest } from './filter-dialog'

const props = defineProps<{
  open: boolean
  title: string
  description?: string
  suspended?: boolean
}>()
const emit = defineEmits<{ close: [] }>()
defineSlots<{ default?: () => unknown; footer?: () => unknown }>()

const dialog = shallowRef<FilterDialogRequest>()
const dialogPhase = shallowRef<'closed' | 'open' | 'leaving'>('closed')
let restoreHistory: (() => void) | undefined

provide(filterDialogKey, (request) => {
  if (!props.open || props.suspended || dialogPhase.value !== 'closed') return
  dialog.value = request
  dialogPhase.value = 'open'
})

watch(
  () => props.open,
  (open) => {
    if (open) return
    dialogPhase.value = 'closed'
    dialog.value = undefined
    restoreHistory = undefined
  },
)

function closeDialog(restore = false): void {
  if (dialogPhase.value !== 'open') return
  if (restore) restoreHistory = dialog.value?.platformHistory?.restore
  dialogPhase.value = 'leaving'
}

async function finishDialog(): Promise<void> {
  if (dialogPhase.value !== 'leaving') return
  const restore = restoreHistory
  restoreHistory = undefined
  // The sheet must lose inert before restoring focus or applying a history entry.
  dialogPhase.value = 'closed'
  await nextTick()
  if (props.open && !props.suspended && dialogPhase.value === 'closed') restore?.()
}
</script>

<template>
  <BottomSheet
    :open="open"
    :title="title"
    :description="description"
    size="full"
    :suspended="suspended || dialogPhase !== 'closed'"
    @close="emit('close')"
  >
    <slot />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </BottomSheet>
  <div class="collection-filter-sheet__overlay">
    <AppDialog
      :open="open && dialogPhase === 'open'"
      :suspended="suspended"
      :title="dialog?.title ?? ''"
      :description="dialog?.description"
      :return-focus-selector="dialog?.returnFocusSelector"
      size="compact"
      @close="closeDialog()"
      @after-leave="finishDialog"
    >
      <FilterHistoryChips v-if="dialog?.platformHistory" :labels="dialog.platformHistory.labels" />
      <template v-if="dialog?.platformHistory" #footer>
        <button class="collection-filter-sheet__restore" type="button" @click="closeDialog(true)">
          恢复筛选
        </button>
      </template>
    </AppDialog>
  </div>
</template>

<style scoped>
.collection-filter-sheet__overlay {
  position: absolute;
  z-index: calc(var(--am-z-dialog) + 1);
  inset: 0;
  pointer-events: none;
}
.collection-filter-sheet__restore {
  min-block-size: 44px;
  padding: var(--am-space-2) var(--am-space-4);
  border: 1px solid var(--am-color-primary);
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}
.collection-filter-sheet__restore:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
