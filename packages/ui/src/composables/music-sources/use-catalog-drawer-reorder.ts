import { computed, onDeactivated, onScopeDispose, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import {
  PINNED_DRAWER_REORDER_MESSAGE,
  QUEUE_DRAG_READY_MESSAGE,
} from '../../product/action-feedback'
import type { CatalogDrawerView } from '../../product/catalog-drawer'
import { useActionFeedback } from '../use-action-feedback'
import { useGridReorder } from '../use-grid-reorder'
import { useLongPressDrag } from '../use-long-press-drag'

interface UseCatalogDrawerReorderOptions {
  drawers: MaybeRefOrGetter<readonly CatalogDrawerView[]>
  element: MaybeRefOrGetter<HTMLElement | null>
  suspended: MaybeRefOrGetter<boolean>
  move: (id: string, targetId: string, visibleIds: readonly string[]) => void
}

/** 卡片空白长按后进入预览，和待听共用手势及排序；松手、取消均不改变选择。 */
export function useCatalogDrawerReorder(options: UseCatalogDrawerReorderOptions) {
  const showFeedback = useActionFeedback()
  const drawers = computed(() => toValue(options.drawers))
  const groups = computed(
    () => new Map(drawers.value.map((item) => [item.id, Boolean(item.isPinned)])),
  )
  const orderAndGroups = computed(() =>
    JSON.stringify(drawers.value.map((item) => [item.id, Boolean(item.isPinned)])),
  )
  const reorder = useGridReorder({
    idsByKind: computed(() => ({ drawer: drawers.value.map((item) => item.id) })),
    scrollElement: options.element,
    attributePrefix: 'catalog',
    getGroupId: (_kind, id) => (groups.value.get(id) ? 'pinned' : 'regular'),
    onGroupMismatch: () =>
      showFeedback({ status: 'warning', message: PINNED_DRAWER_REORDER_MESSAGE }),
    move: (_kind, id, target, ids) => options.move(id, target, ids),
  })
  const press = useLongPressDrag({
    target: options.element,
    startDrag: (event, id) => {
      reorder.startDrag(event, 'drawer', id)
      if (reorder.dragKind.value === 'drawer' && reorder.draggedId.value === id)
        showFeedback({ status: 'info', icon: 'drag', message: QUEUE_DRAG_READY_MESSAGE })
    },
    cancelDrag: reorder.clearDrag,
  })

  function cancel(): void {
    press.cancel()
    reorder.clearDrag()
  }

  function startPress(event: PointerEvent, id: string): void {
    if (toValue(options.suspended) || !drawers.value.some((drawer) => drawer.id === id)) return
    press.start(event, id)
  }

  // 状态/加载数刷新保留指针；同组约束改变才撤销预览，松手后的受控重排保留落位动画。
  watch(
    orderAndGroups,
    () => {
      // 待触发的长按也要取消；落位后的受控更新保留网格的落位动画。
      press.cancel()
      if (reorder.draggedId.value !== undefined) reorder.clearDrag()
    },
    { flush: 'sync' },
  )
  // 网格处理 Escape、失焦和捕获丢失；同步释放本层监听，避免遗留旧指针。
  watch(
    reorder.draggedId,
    (id) => {
      if (id === undefined) press.finish()
    },
    { flush: 'sync' },
  )
  watch(() => toValue(options.suspended), cancel, { flush: 'sync' })
  onDeactivated(cancel)
  onScopeDispose(cancel)
  return {
    ...reorder,
    startPress,
    cancel,
    shift: (...args: Parameters<typeof reorder.shift>) => {
      press.cancel()
      reorder.shift(...args)
    },
  }
}
