import { toValue, watch } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'

/** Only the launcher enters selection mode; item counts never open or close the operator. */
export function useCatalogSelectionOperator(options: {
  context: MaybeRefOrGetter<string | undefined>
  open: Ref<boolean>
  clearSelection?: () => void
}) {
  watch(
    options.open,
    (open) => {
      if (!open) options.clearSelection?.()
    },
    { flush: 'sync' },
  )
  watch(
    () => toValue(options.context),
    () => {
      options.open.value = false
    },
    { flush: 'sync' },
  )
}
