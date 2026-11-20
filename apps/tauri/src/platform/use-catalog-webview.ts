import { invoke } from '@tauri-apps/api/core'
import { nextTick, onMounted, onScopeDispose, watch } from 'vue'
import type { ShallowRef } from 'vue'

import type { CatalogAction, CatalogLayout, CatalogSnapshot } from '../catalog-webview/contracts'
import type { AccountPageBounds } from './account-page'

function visibleBounds(element: HTMLElement): AccountPageBounds | null {
  const box = element.getBoundingClientRect()
  const pixelRatio = devicePixelRatio
  const snap = (coordinate: number) => Math.round(coordinate * pixelRatio) / pixelRatio
  const left = snap(box.left)
  const top = snap(box.top)
  const right = snap(box.right)
  const bottom = snap(box.bottom)
  if (left < 0 || top < 0 || right > innerWidth || bottom > innerHeight) return null
  // Use the host list if clipping would resize the native scroller and change its scroll range.
  for (let ancestor = layoutParent(element); ancestor; ancestor = layoutParent(ancestor)) {
    if (ancestor.inert) return null
    const { overflowX, overflowY } = getComputedStyle(ancestor)
    if (overflowX === 'visible' && overflowY === 'visible') continue
    const clip = ancestor.getBoundingClientRect()
    const clipLeft = clip.left + ancestor.clientLeft
    const clipTop = clip.top + ancestor.clientTop
    // Client dimensions are rounded by the DOM. Allow rounding at a shared edge.
    if (
      (overflowX !== 'visible' &&
        (left < clipLeft - 1 || right > clipLeft + ancestor.clientWidth + 1)) ||
      (overflowY !== 'visible' &&
        (top < clipTop - 1 || bottom > clipTop + ancestor.clientHeight + 1))
    )
      return null
  }
  if (right - left < 32 || bottom - top < 32) return null
  const corners = [
    [left + 2, top + 2],
    [right - 2, top + 2],
    [left + 2, bottom - 2],
    [right - 2, bottom - 2],
    [(left + right) / 2, (top + bottom) / 2],
  ] as const
  // The child WebView is outside the DOM. Check both the slot and theme Shadow roots
  // so a scrolled-out viewport or a dialog above it cannot be overpainted.
  let target: Element = element
  while (true) {
    const root = target.getRootNode() as Document | ShadowRoot
    if (
      typeof root.elementFromPoint === 'function' &&
      corners.some(([x, y]) => !target.contains(root.elementFromPoint(x, y)))
    )
      return null
    if (!(root instanceof ShadowRoot)) break
    target = root.host
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function layoutParent(element: HTMLElement): HTMLElement | null {
  const root = element.getRootNode()
  return element.parentElement ?? (root instanceof ShadowRoot ? (root.host as HTMLElement) : null)
}

async function afterPaint(): Promise<void> {
  await nextTick()
  if (document.hidden) return
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, 100)
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(finish)
    })
    function finish() {
      clearTimeout(timeout)
      cancelAnimationFrame(frame)
      resolve()
    }
  })
}

interface Options {
  accountId: string
  query: string
  suspended: boolean
  snapshot: CatalogSnapshot
  setReady(ready: boolean): void
  onAction(action: CatalogAction): void
  readScroll(): number
  saveScroll(top: number): void
}

interface Result {
  ready: boolean
  supported?: boolean
  scrollTop?: number
  actions?: CatalogAction[]
}

export function useCatalogWebview(
  viewport: Readonly<ShallowRef<HTMLElement | null>>,
  options: Options,
) {
  const lease = crypto.randomUUID()
  const narrowViewport = matchMedia('(max-width: 600px)')
  let disposed = false
  let active = false
  let parked = true
  let handingOff = false
  let supported = true
  let openingOverlay = false
  let polling: Promise<void> | undefined
  let parking: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSent: CatalogSnapshot | undefined
  let lastLayout: CatalogLayout | undefined

  const identity = { lease, accountId: options.accountId, query: options.query }
  const close = () => invoke('close_catalog_webview', { lease }).catch(() => {})

  function scheduleSync(delay: number) {
    clearTimeout(timer)
    if (!disposed && supported && !openingOverlay) timer = setTimeout(poll, delay)
  }

  function poll() {
    if (polling || disposed || !supported || openingOverlay) return
    polling = sync().finally(() => {
      polling = undefined
      if (disposed && !handingOff) void close()
      else scheduleSync(active ? 70 : 150)
    })
  }

  async function sync() {
    // A resumed placement must follow the pending park, even after rapid overlay toggles.
    if (parking) await parking
    const element = viewport.value
    if (disposed || openingOverlay || !element?.isConnected) return
    const region = element.parentElement ?? element
    const bounds = options.suspended || document.hidden ? null : visibleBounds(region)
    if (!bounds) {
      await park()
      return
    }
    try {
      const snapshot = options.snapshot
      const layout: CatalogLayout = {
        padding: getComputedStyle(region).padding,
        viewportSize: narrowViewport.matches ? 'narrow' : 'wide',
      }
      parked = false
      const result = await invoke<Result>('sync_catalog_webview', {
        request: {
          ...identity,
          bounds,
          snapshot:
            !active ||
            snapshot !== lastSent ||
            layout.padding !== lastLayout?.padding ||
            layout.viewportSize !== lastLayout?.viewportSize
              ? {
                  ...snapshot,
                  layout,
                  tracks: lastSent?.tracks === snapshot.tracks ? undefined : snapshot.tracks,
                  scrollTop: active ? undefined : options.readScroll(),
                }
              : undefined,
        },
      })
      if (disposed) return
      supported = result.supported !== false
      if (options.suspended || document.hidden || parked || (!active && !visibleBounds(region))) {
        if (result.ready && parked) {
          // An in-flight sync can make the child visible after the first park was sent.
          if (parking) await parking
          if (disposed) return
          parked = false
        }
        await park()
        return
      }
      const wasActive = active
      active = result.ready
      lastSent = active ? snapshot : undefined
      lastLayout = active ? layout : undefined
      if (active && !wasActive && !openingOverlay) {
        await afterPaint()
        if (disposed || parked) return
        if (options.suspended || document.hidden || !visibleBounds(region)) {
          await park()
          return
        }
      }
      if (!openingOverlay) options.setReady(active)
      if (active && result.scrollTop !== undefined) {
        const scrollTop = result.scrollTop
        await nextTick()
        if (!disposed && active) options.saveScroll(scrollTop)
      }
      if (active) {
        for (const action of result.actions ?? []) {
          if (action.type === 'actions') openOverlay(() => options.onAction(action), false)
          else options.onAction(action)
        }
      }
    } catch {
      if (disposed) return
      active = false
      parked = true
      lastSent = undefined
      options.setReady(false)
      await close()
    }
  }
  function park(): Promise<void> | undefined {
    if (parking) return parking
    if (parked) return
    const region = viewport.value?.parentElement
    const paintFallback = active && region?.isConnected
    active = false
    parked = true
    options.setReady(false)
    parking = (async () => {
      // Mount and paint the host list beneath the child before moving it out of the viewport.
      if (paintFallback) await afterPaint()
      if (disposed) return
      try {
        await invoke('sync_catalog_webview', { request: identity })
      } catch {
        lastSent = undefined
        await close()
      }
    })().finally(() => {
      parking = undefined
    })
    return parking
  }

  function openOverlay(open: () => void, refreshScroll = true): void {
    if (disposed || openingOverlay) return
    if (!supported || (parked && !parking && !polling)) {
      open()
      return
    }
    clearTimeout(timer)
    // Host toolbar clicks sample the child again. A child row action already carries its scroll.
    if (refreshScroll && active && !polling) poll()
    openingOverlay = true
    void (async () => {
      try {
        await polling
        if (disposed) return
        await park()
        if (!disposed && !options.suspended && !document.hidden) open()
      } finally {
        // Let the theme publish its modal state before permitting another placement.
        await nextTick()
        openingOverlay = false
        scheduleSync(150)
      }
    })()
  }
  const visibilityChanged = () => {
    if (document.hidden) void park()
  }
  watch(
    () => options.suspended,
    (suspended) => {
      if (suspended) void park()
      else scheduleSync(0)
    },
    { flush: 'sync' },
  )
  onMounted(() => {
    document.addEventListener('visibilitychange', visibilityChanged)
    poll()
  })
  onScopeDispose(() => {
    disposed = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', visibilityChanged)
    const region = viewport.value?.parentElement
    handingOff = (active || Boolean(parking)) && Boolean(region?.isConnected) && !document.hidden
    active = false
    options.setReady(false)
    if (!handingOff) {
      void close()
      return
    }
    // Reveal the restored list behind the child WebView before releasing its lease.
    void nextTick(async () => {
      if (region?.isConnected) await afterPaint()
      await close()
    })
  })
  return { openOverlay }
}
