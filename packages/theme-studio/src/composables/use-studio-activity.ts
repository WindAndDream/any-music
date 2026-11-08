import { useConfirmAction } from '@any-music/ui/library'
import type { UiThemeAvailability } from '@any-music/ui/theme'
import { onActivated, onDeactivated, onScopeDispose } from 'vue'

/** Async confirmations remain bound to the initiating presentation and feature identity. */
export function useStudioActivity(availability: () => UiThemeAvailability) {
  let active = true
  let generation = 0
  const confirm = useConfirmAction()
  function invalidate() {
    active = false
    generation++
  }
  onActivated(() => {
    active = true
  })
  onDeactivated(invalidate)
  onScopeDispose(invalidate)
  const available = () => active && availability().status === 'available'
  const checkpoint = () => {
    const current = generation
    return () => available() && generation === current
  }
  async function confirmAction(
    title: string,
    message: string,
    action: () => void | Promise<void>,
    current: () => boolean = () => true,
    tone: 'default' | 'danger' = 'danger',
  ) {
    if (!available()) return
    const requestedGeneration = generation
    if (await confirm({ title, message, tone }))
      if (available() && generation === requestedGeneration && current()) await action()
  }
  return { available, confirmAction, checkpoint }
}
