<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { inject, useId, useTemplateRef } from 'vue'

import { filterDialogKey } from './filter-dialog'

const props = defineProps<{ label: string; description: string }>()
const showHelp = inject(filterDialogKey)
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const triggerId = useId()

function open(): void {
  trigger.value?.focus({ preventScroll: true })
  showHelp?.({
    title: `${props.label}说明`,
    description: props.description,
    returnFocusSelector: `[data-filter-help="${triggerId}"]`,
  })
}
</script>

<template>
  <button
    v-if="showHelp"
    ref="trigger"
    class="catalog-filter-help__trigger"
    type="button"
    :data-filter-help="triggerId"
    :aria-label="`${label}说明`"
    aria-haspopup="dialog"
    @click="open"
  >
    <AppIcon class="catalog-filter-help__icon" name="help" :size="18" />
  </button>
</template>

<style scoped>
.catalog-filter-help__trigger {
  display: inline-grid;
  flex: none;
  place-items: center start;
  inline-size: 44px;
  block-size: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-primary);
  cursor: pointer;
}
.catalog-filter-help__trigger:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -2px;
}
@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .catalog-filter-help__icon {
    transition: transform var(--am-motion-fast) var(--am-ease-standard);
  }
  .catalog-filter-help__trigger:hover .catalog-filter-help__icon {
    transform: rotate(-8deg) scale(1.1);
  }
}
</style>
