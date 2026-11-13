import { onActivated, onDeactivated, onScopeDispose } from 'vue'

/** A confirmation belongs to its initiating presentation, including cached-page activation. */
export function usePresentationActivity() {
  let active = true
  let generation = 0
  function invalidate() {
    active = false
    generation += 1
  }
  onActivated(() => {
    active = true
  })
  onDeactivated(invalidate)
  onScopeDispose(invalidate)
  return {
    checkpoint() {
      const current = generation
      return () => active && current === generation
    },
  }
}
