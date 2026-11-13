import { useBackHandler, useBackNavigation } from '@any-music/ui'
import type { ProductViewId } from '@any-music/ui'
import { shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

const MAX_HISTORY_LENGTH = 64

/** Record actual destination changes, including business shortcuts, without persisting UI history. */
export function useWorkbenchBackNavigation(options: {
  current: MaybeRefOrGetter<ProductViewId>
  select: (id: ProductViewId) => void
  available: MaybeRefOrGetter<readonly ProductViewId[]>
}) {
  const navigation = useBackNavigation()
  const history = shallowRef<readonly ProductViewId[]>([])
  let isReturning = false
  watch(
    () => toValue(options.current),
    (_, previous) => {
      if (!navigation) return
      navigation.invalidate()
      if (!isReturning) history.value = [...history.value, previous].slice(-MAX_HISTORY_LENGTH)
    },
    { flush: 'sync' },
  )

  function back(): void {
    const entries = [...history.value]
    const available = toValue(options.available)
    let previous: ProductViewId | undefined
    while (entries.length) {
      const candidate = entries.pop()!
      if (candidate !== toValue(options.current) && available.includes(candidate)) {
        previous = candidate
        break
      }
    }
    history.value = entries
    if (!previous) return
    isReturning = true
    try {
      options.select(previous)
    } finally {
      isReturning = false
    }
  }

  useBackHandler({
    active: () =>
      history.value.some(
        (id) => id !== toValue(options.current) && toValue(options.available).includes(id),
      ),
    handle: back,
    layer: 'navigation',
  })
}
