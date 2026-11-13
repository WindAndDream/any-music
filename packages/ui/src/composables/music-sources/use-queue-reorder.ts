import { computed, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { QUEUE_DRAG_READY_MESSAGE } from '../../product/action-feedback'
import type { GridReorderGeometryFactory } from '../grid-reorder-geometry'
import { useActionFeedback } from '../use-action-feedback'
import { useGridReorder } from '../use-grid-reorder'
import { useLongPressDrag } from '../use-long-press-drag'

interface UseQueueReorderOptions {
  arrangementMode: MaybeRefOrGetter<'flat' | 'platform'>
  trackIds: MaybeRefOrGetter<readonly string[]>
  platformIds: MaybeRefOrGetter<readonly string[]>
  scrollElement: MaybeRefOrGetter<HTMLElement | null>
  /** Existing viewport and optional semantic geometry for virtual track consumers. */
  autoScrollElement?: MaybeRefOrGetter<HTMLElement | null>
  createGeometry?: GridReorderGeometryFactory<'track' | 'platform'>
  retainItem?: (kind: 'track' | 'platform', id: string) => (() => void) | undefined
  focusItem?: (kind: 'track' | 'platform', id: string, signal: AbortSignal) => Promise<boolean>
  getPlatformId: (trackId: string) => string | undefined
  moveTrack: (draggedId: string, targetId: string, visibleIds: readonly string[]) => void
  movePlatform: (draggedId: string, targetId: string, visibleIds: readonly string[]) => void
}

/** 待听只定义歌曲/平台的排序边界，指针捕获、二维让位和落位由共享网格处理。 */
export function useQueueReorder(options: UseQueueReorderOptions) {
  const showFeedback = useActionFeedback()
  const idsByKind = computed(() => ({
    track: toValue(options.trackIds),
    platform: toValue(options.platformIds),
  }))
  const reorder = useGridReorder<'track' | 'platform'>({
    idsByKind,
    scrollElement: options.scrollElement,
    // Consumers may replace an active virtual surface while this stable gesture owner lives.
    // Read the optional adapter at use time so overview/legacy views retain the DOM path.
    get autoScrollElement() {
      return options.autoScrollElement
    },
    get createGeometry() {
      return options.createGeometry
    },
    get retainItem() {
      return options.retainItem
    },
    get focusItem() {
      return options.focusItem
    },
    attributePrefix: 'queue',
    getGroupId: (kind, id) =>
      kind === 'track' && toValue(options.arrangementMode) === 'platform'
        ? options.getPlatformId(id)
        : undefined,
    getGroupElement: (kind, element) =>
      kind === 'track' && toValue(options.arrangementMode) === 'platform'
        ? element.closest('[data-queue-platform-view]')
        : null,
    move: (kind, id, target, ids) => {
      if (kind === 'track') options.moveTrack(id, target, ids)
      else options.movePlatform(id, target, ids)
    },
  })
  function createPress(kind: 'track' | 'platform') {
    return useLongPressDrag({
      target: options.scrollElement,
      startDrag: (event, id) => {
        reorder.startDrag(event, kind, id)
        // 仅长按真正取得网格排序控制权后提示，移动和落位不会重复打断提示。
        if (reorder.dragKind.value === kind && reorder.draggedId.value === id)
          showFeedback({ status: 'info', icon: 'drag', message: QUEUE_DRAG_READY_MESSAGE })
      },
      cancelDrag: reorder.clearDrag,
    })
  }
  const coverDrag = createPress('track')
  const platformDrag = createPress('platform')
  // 网格失去捕获或尺寸观察器取消排序时，也释放封面的触屏接管与等待监听器。
  watch(
    reorder.draggedId,
    (id, previous) => {
      if (previous && !id) {
        coverDrag.finish()
        platformDrag.finish()
      }
    },
    { flush: 'sync' },
  )
  function clearDrag(): void {
    coverDrag.cancel()
    platformDrag.cancel()
    reorder.clearDrag()
  }
  // 切换排列撤销整个手势；提交自身的新顺序只结束长按，保留网格的落位交接。
  watch(() => toValue(options.arrangementMode), clearDrag, { flush: 'sync' })
  watch(
    () => JSON.stringify(idsByKind.value),
    () => {
      coverDrag.cancel()
      platformDrag.cancel()
      if (reorder.draggedId.value !== undefined) reorder.clearDrag()
    },
    { flush: 'sync' },
  )
  return {
    ...reorder,
    startTrackPress: coverDrag.start,
    startPlatformPress: platformDrag.start,
    clearDrag,
    shift: (...args: Parameters<typeof reorder.shift>) => {
      coverDrag.cancel()
      platformDrag.cancel()
      reorder.shift(...args)
    },
  }
}
