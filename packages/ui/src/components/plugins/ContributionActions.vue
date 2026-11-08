<script setup lang="ts">
import { computed, inject, shallowRef, watch } from 'vue'

import { UI_CONTRIBUTIONS } from '../../product/ui-contributions'
import type {
  UiContributionPoint,
  UiListContext,
  UiContributionItem,
} from '../../product/ui-contributions'
import ContributionInputDialog from './ContributionInputDialog.vue'

const props = defineProps<{
  point: UiContributionPoint
  context: Partial<UiListContext>
  disabled?: boolean
  overlayTarget?: HTMLElement | null
}>()
const emit = defineEmits<{ dialogOpenChange: [open: boolean] }>()
const host = inject(UI_CONTRIBUTIONS, undefined)
const items = computed(
  () => host?.resolve(props.point, props.context).filter((entry) => entry.title) ?? [],
)
const editing = shallowRef<UiContributionItem>()
const activeItem = computed(() => {
  const item = editing.value
  return item && !props.disabled && host?.accepts(item, props.point, props.context)
    ? items.value.find((entry) => entry.id === item.id)
    : undefined
})
watch(
  () => Boolean(activeItem.value),
  (open) => {
    if (!open) editing.value = undefined
    emit('dialogOpenChange', open)
  },
  { flush: 'sync' },
)
function apply(item: UiContributionItem, value?: string): void {
  if (props.disabled || !host?.accepts(item, props.point, props.context)) return
  if (
    value !== undefined &&
    (!value.trim() ||
      item.inputOptions?.some(
        (option) =>
          option.selected && option.value.toLocaleLowerCase() === value.trim().toLocaleLowerCase(),
      ))
  )
    return
  host.invoke?.(item, props.point, props.context, value)
}
function request(item: UiContributionItem): void {
  if (props.disabled || !host?.accepts(item, props.point, props.context)) return
  if (item.inputLabel) {
    editing.value = item
  } else apply(item)
}
function submit(values: readonly string[]): void {
  const item = activeItem.value
  if (!item) return
  for (const value of values) apply(item, value)
  editing.value = undefined
}
</script>
<template>
  <template v-for="item in items" :key="item.id">
    <button
      type="button"
      :disabled="props.disabled"
      :aria-haspopup="item.inputLabel ? 'dialog' : undefined"
      @click="request(item)"
    >
      {{ item.title }}
    </button>
  </template>
  <Teleport :to="overlayTarget" :disabled="!overlayTarget">
    <ContributionInputDialog
      :open="Boolean(activeItem)"
      :title="activeItem?.title ?? ''"
      :label="activeItem?.inputLabel ?? ''"
      :options="activeItem?.inputOptions"
      :selection-count="context.selectionCount ?? 0"
      @submit="submit"
      @close="editing = undefined"
    />
  </Teleport>
</template>
