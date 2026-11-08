import { createConfirmationDialogController, useBackNavigationScope } from '@any-music/ui'
import type { ConfirmationDialogController } from '@any-music/ui'
import { onScopeDispose, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

/** Account details live above the theme surface, so their confirmation shares the protected host. */
export function useAccountSettingsConfirmation(options: {
  detailOpen: MaybeRefOrGetter<boolean>
  suspended: MaybeRefOrGetter<boolean | undefined>
}): ConfirmationDialogController {
  const confirmation = createConfirmationDialogController()
  watch(
    [() => toValue(options.detailOpen), () => toValue(options.suspended)],
    ([open, suspended]) => {
      if (!open || suspended) confirmation.cancel()
    },
    { flush: 'sync' },
  )
  useBackNavigationScope({
    active: () => Boolean(confirmation.activeRequest.value),
    layer: 'modal',
    handle: confirmation.cancel,
  })
  onScopeDispose(confirmation.dispose)
  return {
    ...confirmation,
    confirm: (request) =>
      !toValue(options.detailOpen) || toValue(options.suspended)
        ? Promise.resolve(false)
        : confirmation.confirm(request),
  }
}
