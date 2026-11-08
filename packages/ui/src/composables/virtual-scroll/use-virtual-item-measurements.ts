import { computed, nextTick, onScopeDispose, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import type { useVirtualScrollContext } from './use-virtual-scroll-context'
import type { VirtualItemKey } from './virtual-row-geometry'
import { observeVirtualElement } from './virtual-scroll-resize-observer'

export type VirtualItemGeneration = string | number

export interface VirtualItemMeasurementsOptions {
  context: ReturnType<typeof useVirtualScrollContext>
  /** Density, typography or other caller-owned layout changes, in addition to measured width. */
  layoutGeneration?: MaybeRefOrGetter<VirtualItemGeneration>
  /** Undefined means the occurrence no longer exists. Include title/tags/expansion changes. */
  getContentGeneration: (key: VirtualItemKey) => VirtualItemGeneration | undefined
  /** Maximum remembered natural heights, including mounted occurrences. Default: 512. */
  cacheLimit?: number
}

interface HeightEntry {
  content: VirtualItemGeneration
  height: number
}
interface MeasurementJob {
  read: () => number | undefined
  commit: (height: number) => { changed: boolean; reflow: boolean } | undefined
}

/**
 * Presentation-local natural border-box heights. Only explicitly mounted units are observed.
 * Targets must have natural height, without size containment, placeholder height or scaling;
 * positioning/motion belongs on another layer. Nothing here writes styles or scroll offsets.
 */
export function useVirtualItemMeasurements(options: VirtualItemMeasurementsOptions) {
  const limit = options.cacheLimit ?? 512
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid height cache limit')
  const cache = new Map<VirtualItemKey, HeightEntry>()
  const publication = shallowRef({ revision: 0, reflow: 0 })
  const isWidthMeasurementPending = shallowRef(false)
  const { context } = options
  const disposers = new Map<VirtualItemKey, () => void>()
  const elementDisposers = new Map<HTMLElement, () => void>()
  const pending = new Map<HTMLElement, MeasurementJob>()
  const refreshers = new Set<() => void>()
  const widthReaders = new Set<() => MeasurementJob | undefined>()
  let disposed = false
  let scheduled = false

  function publish(reflow = false) {
    // Publish height authority and its cause atomically. Newly mounted measurements still
    // update rendering/anchors/dragging, but are not a resize of an existing mounted unit.
    publication.value = {
      revision: publication.value.revision + 1,
      reflow: publication.value.reflow + Number(reflow),
    }
  }
  function flush() {
    scheduled = false
    if (disposed) return
    const batch = [...pending.values()]
    pending.clear()
    commitBatch(batch)
  }
  function commitBatch(batch: readonly MeasurementJob[]) {
    // Complete every geometry read before notifying Vue/the virtualizer of any size changes.
    const heights = batch.map((job) => job.read())
    let changed = false
    let reflow = false
    batch.forEach((job, index) => {
      const height = heights[index]
      if (height === undefined) return
      const result = job.commit(height)
      changed = result?.changed || changed
      reflow = result?.reflow || reflow
    })
    if (changed) publish(reflow)
  }
  function schedule(element: HTMLElement, job: MeasurementJob) {
    pending.set(element, job)
    if (scheduled) return
    scheduled = true
    void nextTick(flush)
  }

  // Hidden zero-width reports do not replace the last usable layout. Root replacement and
  // width/density changes discard old heights; returning to a previous width cannot revive them.
  watch(
    () =>
      [
        context.metrics.value.ready ? context.metrics.value.listWidth : undefined,
        context.scrollElement.value,
        toValue(options.layoutGeneration),
      ] as const,
    (next, previous) => {
      if (!previous) return
      if (
        (next[0] !== undefined && next[0] !== previous[0]) ||
        next[1] !== previous[1] ||
        next[2] !== previous[2]
      ) {
        // Geometry invalidates immediately. Motion can wait for this width's natural
        // measurements instead of animating both the temporary estimates and the result.
        isWidthMeasurementPending.value =
          next[0] !== undefined &&
          next[0] !== previous[0] &&
          next[1] === previous[1] &&
          next[2] === previous[2]
        if (cache.size) {
          cache.clear()
          publish(true)
        }
        if (isWidthMeasurementPending.value) {
          // Container RO has resolved CSS at this width. Measure the still-mounted natural
          // units before Vue patches estimate rows/spacers and dirties layout again. This
          // discards old authority and publishes one current-width batch before rendering.
          commitBatch([...widthReaders].flatMap((read) => read() ?? []))
          isWidthMeasurementPending.value = false
        }
      }
    },
    { flush: 'sync' },
  )
  // Observe only bounded remembered content, never one watcher per dataset item. Reading
  // revision discovers new cache entries; a mismatch evicts rather than retaining generations.
  watch(
    () => {
      void publication.value
      return [...cache]
        .filter(([key, entry]) => options.getContentGeneration(key) !== entry.content)
        .map(([key]) => key)
    },
    (stale) => {
      for (const key of stale) cache.delete(key)
      if (stale.length) publish(true)
    },
    { flush: 'sync' },
  )

  function observeItem(key: VirtualItemKey, element: HTMLElement): () => void {
    if (disposed) return () => {}
    disposers.get(key)?.()
    elementDisposers.get(element)?.()
    let active = true
    // A mounted unit can outlive its bounded cache entry. Keep only its own last natural
    // height, so delayed artwork/resize remains a reflow after cache eviction. Remounting
    // starts a new observation and never inherits motion from the preceding window.
    let observedHeight: number | undefined
    let lastMeasurement:
      | {
          root: HTMLElement | null
          width: number
          layout: VirtualItemGeneration | undefined
          content: VirtualItemGeneration
        }
      | undefined
    function createJob(): MeasurementJob | undefined {
      const { ready, listWidth: width } = context.metrics.value
      const root = context.scrollElement.value
      const layout = toValue(options.layoutGeneration)
      const content = options.getContentGeneration(key)
      if (!ready || content === undefined || !active || disposed) return
      const isCurrent = () =>
        active &&
        !disposed &&
        element.isConnected &&
        context.metrics.value.ready &&
        context.scrollElement.value === root &&
        context.metrics.value.listWidth === width &&
        toValue(options.layoutGeneration) === layout &&
        options.getContentGeneration(key) === content
      return {
        read: () => {
          if (!isCurrent()) return undefined
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && Number.isFinite(rect.height) && rect.height > 0
            ? rect.height
            : undefined
        },
        commit: (height) => {
          if (!isCurrent()) return undefined
          const previous = cache.get(key)
          const reflow = observedHeight !== undefined && observedHeight !== height
          observedHeight = height
          lastMeasurement = { root, width, layout, content }
          cache.delete(key)
          cache.set(key, { content, height })
          while (cache.size > limit) cache.delete(cache.keys().next().value!)
          return { changed: previous?.content !== content || previous.height !== height, reflow }
        },
      }
    }
    const readWidth = () => {
      pending.delete(element)
      return createJob()
    }
    widthReaders.add(readWidth)
    const measure = () => {
      const job = createJob()
      if (job) schedule(element, job)
    }
    let subscriptionRoot: HTMLElement | null | undefined
    let releaseSubscription: (() => void) | undefined
    function unsubscribe() {
      releaseSubscription?.()
      releaseSubscription = undefined
      subscriptionRoot = undefined
    }
    const stop = watch(
      [
        () => context.metrics.value.ready,
        () => context.scrollElement.value,
        () => context.metrics.value.listWidth,
        () => toValue(options.layoutGeneration),
        () => options.getContentGeneration(key),
      ],
      ([ready, root, width, layout, content]) => {
        if (!ready || content === undefined) {
          unsubscribe()
          return
        }
        // Width/content changes replace the pending job, keeping the mounted element's
        // observer/load subscriptions stable throughout continuous layout changes.
        if (subscriptionRoot !== root) {
          unsubscribe()
          const release = observeVirtualElement(element, measure)
          // Local capture covers delayed image loads even without ResizeObserver.
          element.addEventListener('load', measure, true)
          refreshers.add(measure)
          subscriptionRoot = root
          releaseSubscription = () => {
            release?.()
            refreshers.delete(measure)
            element.removeEventListener('load', measure, true)
          }
        }
        if (
          lastMeasurement?.root !== root ||
          lastMeasurement.width !== width ||
          lastMeasurement.layout !== layout ||
          lastMeasurement.content !== content
        )
          measure()
      },
      { immediate: true, flush: 'post' },
    )
    const dispose = () => {
      if (!active) return
      active = false
      stop()
      unsubscribe()
      widthReaders.delete(readWidth)
      pending.delete(element)
      if (disposers.get(key) === dispose) disposers.delete(key)
      if (elementDisposers.get(element) === dispose) elementDisposers.delete(element)
    }
    disposers.set(key, dispose)
    elementDisposers.set(element, dispose)
    return dispose
  }

  onScopeDispose(() => {
    disposed = true
    for (const dispose of disposers.values()) dispose()
    pending.clear()
    cache.clear()
    publish()
    isWidthMeasurementPending.value = false
  })
  return {
    observeItem,
    /** Re-read mounted natural units after an explicit layout change, also usable without RO. */
    refresh: () => {
      for (const refresh of refreshers) refresh()
    },
    revision: computed(() => publication.value.revision),
    /** Mounted natural-height changes/invalidation only; window ingress is not FLIP. */
    reflowRevision: computed(() => publication.value.reflow),
    isWidthMeasurementPending: computed(() => isWidthMeasurementPending.value),
    cacheSize: computed(() => {
      void publication.value
      return cache.size
    }),
    /** Bounded snapshot for total-extent calculation, including while the viewport is hidden. */
    heights: computed<ReadonlyMap<VirtualItemKey, number>>(() => {
      void publication.value
      return new Map([...cache].map(([key, entry]) => [key, entry.height]))
    }),
    getHeight: (key: VirtualItemKey) => {
      void publication.value
      const entry = cache.get(key)
      return entry && entry.content === options.getContentGeneration(key) ? entry.height : undefined
    },
  }
}
