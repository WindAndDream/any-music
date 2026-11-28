import { onScopeDispose, watch } from 'vue'
import type { Ref } from 'vue'

import { layoutAccountPage } from '../../platform/account-page'
import type { AccountPageBounds } from '../../platform/account-page'

/**
 * Keep the native page on top of its placeholder while visible. Dialog transitions, scrolling
 * and window resizes move the placeholder without resize events, so one frame loop compares
 * its rendered box and reports only changes. Any other state hides the native page.
 */
export function useAccountPageLayout(
  placeholder: Readonly<Ref<HTMLElement | null | undefined>>,
  target: () => { accountId: string; visible: boolean } | undefined,
) {
  let frame: number | undefined
  let reported: { accountId: string; key: string } | undefined
  function stop() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }
  function report(accountId: string, bounds: AccountPageBounds | null) {
    const key = bounds ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}` : 'hidden'
    if (reported?.accountId === accountId && reported.key === key) return
    reported = { accountId, key }
    void layoutAccountPage(accountId, bounds)
  }
  function hide() {
    if (reported && reported.key !== 'hidden') void layoutAccountPage(reported.accountId, null)
    reported = undefined
  }
  function measure() {
    frame = undefined
    const current = target()
    const element = placeholder.value
    if (!current?.visible || !element?.isConnected) return
    const box = element.getBoundingClientRect()
    report(
      current.accountId,
      box.width >= 1 && box.height >= 1
        ? {
            x: Math.round(box.left),
            y: Math.round(box.top),
            width: Math.round(box.width),
            height: Math.round(box.height),
          }
        : null,
    )
    frame = requestAnimationFrame(measure)
  }
  watch(
    () => {
      const current = target()
      return current?.visible ? current.accountId : undefined
    },
    (accountId) => {
      stop()
      if (accountId === undefined || reported?.accountId !== accountId) hide()
      if (accountId !== undefined) frame = requestAnimationFrame(measure)
    },
    { immediate: true, flush: 'post' },
  )
  onScopeDispose(() => {
    stop()
    hide()
  })
}
