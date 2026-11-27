import type { Track } from '@any-music/core'
import { TrackList } from '@any-music/theme-default/vue'
import {
  createEditingSession,
  provideEditingSession,
  provideTrackNames,
} from '@any-music/ui/catalog'
import { computed, createApp, h, nextTick, shallowRef } from 'vue'

import type {
  CatalogAction,
  CatalogLayout,
  CatalogSnapshot,
  CatalogUpdate,
  TrackAction,
} from './contracts'
import { createCatalogDocumentMask } from './document-mask'

interface CatalogBridge {
  sync(
    snapshot?: CatalogUpdate,
  ): Promise<{ ready: boolean; actions: CatalogAction[]; scrollTop: number }>
  close(): void
}
const catalogGlobal = globalThis as unknown as Record<string, CatalogBridge | undefined>

const layoutStyles = `
:host { font: 16px system-ui, sans-serif; color-scheme: light dark; }
.catalog-frame {
  display: flex; flex-direction: column;
  inline-size: 100%; block-size: 100%; min-inline-size: 0;
  container-type: inline-size;
  background: var(--am-color-background); color: var(--am-color-text);
  overflow: clip;
}
.catalog-frame > .catalog-page {
  display: flex; flex: 1; flex-direction: column; min-block-size: 0;
}
`

function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    // A parked WebView can throttle animation frames. Never hold the native lease
    // or block reuse of the account's search page while waiting on the compositor.
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

// This entry runs in a native-created isolated JavaScript world. The fixed markup,
// business projection and accepted events stay inside its closed Shadow root.
export function install(origin: string, lease: string, bridgeKey: string, css: string): boolean {
  if (
    window !== window.top ||
    location.origin !== origin ||
    Object.hasOwn(window, '__TAURI_INTERNALS__') ||
    !document.body
  )
    return false
  catalogGlobal[bridgeKey]?.close()

  const pathname = location.pathname
  const host = document.createElement('div')
  host.dataset.amCatalogHost = lease
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = new CSSStyleSheet()
  style.replaceSync(css + layoutStyles)
  shadow.adoptedStyleSheets = [style]
  const mount = document.createElement('div')
  mount.style.blockSize = '100%'
  shadow.append(mount)
  const current = shallowRef<CatalogSnapshot & { layout: CatalogLayout }>()
  const scrollElement = shallowRef<HTMLElement | null>(null)
  const trackList = shallowRef<{ ready: boolean; restorePosition(position: number): void } | null>(
    null,
  )
  const names = computed(() => new Map(current.value?.names))
  const actions: CatalogAction[] = []
  let disposed = false
  const mask = createCatalogDocumentMask(host, lease)
  const isCurrentDocument = () =>
    !disposed &&
    location.origin === origin &&
    location.pathname === pathname &&
    mask.hasOriginalBody()

  // Synthetic events cannot activate a row in the isolated surface.
  for (const event of ['click', 'change', 'keydown'])
    shadow.addEventListener(
      event,
      (input) => {
        if (!input.isTrusted) input.stopImmediatePropagation()
      },
      true,
    )

  function send(action: CatalogAction): void {
    if (actions.length < 24) actions.push(action)
  }
  function sendTrack(type: TrackAction, track: Track) {
    send({ type, id: track.id })
  }
  const editing = createEditingSession()
  const app = createApp({
    setup() {
      provideEditingSession(editing)
      provideTrackNames(names)
      return () => {
        const value = current.value
        if (!value) return
        const common = {
          class: ['catalog-frame', 'am-root', 'am-theme-default'],
          'data-am-theme': value.colorScheme,
          'data-am-ui-theme': 'default',
          'data-am-ui-density': value.density,
          'data-am-theme-root': '',
        }
        return h('div', common, [
          h('div', { class: 'catalog-page catalog-page--tracks' }, [
            h(
              'div',
              {
                ref: scrollElement,
                class: 'catalog-page__tracks-scroll',
                style: { padding: value.layout.padding },
              },
              [
                h('div', { class: 'catalog-drawer' }, [
                  h('div', { class: 'catalog-drawer__panel' }, [
                    h(TrackList, {
                      ref: trackList,
                      listingId: value.drawer.id,
                      virtualized: true,
                      scrollElement: scrollElement.value,
                      viewportSize: value.layout.viewportSize,
                      prefetch: true,
                      tracks: value.tracks,
                      customTagsByTrackId: new Map(value.tags),
                      currentTrackId: value.currentTrackId,
                      invalidTrackIds: new Set(value.invalid),
                      selectedTrackIds: new Set(value.selected),
                      favoriteTrackIds: new Set(value.favorite),
                      selectable: value.selectable,
                      displayMode: value.displayMode,
                      itemStyle: value.itemStyle,
                      mobileColumns: value.mobileColumns,
                      downloadBusy: value.downloadBusy,
                      loading: value.drawer.isLoading || value.drawer.status === 'restoring',
                      hasMore:
                        value.drawer.hasMore &&
                        value.drawer.isSourceEnabled &&
                        !value.drawer.paginationLocked,
                      loadedPageCount: value.drawer.loadedPageCount,
                      loadedTrackCount: value.loadedTrackCount,
                      errorMessage: '',
                      onPlay: (track) => sendTrack('play', track),
                      onDownload: (track) => sendTrack('download', track),
                      onFavorite: (track) => sendTrack('favorite', track),
                      onSelect: (id) => send({ type: 'select', id }),
                      onShowActions: (track) => sendTrack('actions', track),
                      onLoadMore: () => send({ type: 'more' }),
                    }),
                  ]),
                ]),
              ],
            ),
          ]),
        ])
      }
    },
  })
  app.mount(mount)

  const bridge: CatalogBridge = {
    async sync(snapshot) {
      if (!isCurrentDocument()) return { ready: false, actions: [], scrollTop: 0 }
      if (snapshot) {
        const previous = current.value
        const tracks = snapshot.tracks ?? previous?.tracks
        if (!tracks) return { ready: false, actions: [], scrollTop: 0 }
        // The windowing context can measure a connected list even while native keeps it parked.
        if (!previous) mask.show()
        current.value = { ...snapshot, tracks }
        await nextTick()
        if (isCurrentDocument() && !trackList.value?.ready) await afterPaint()
        if (!isCurrentDocument() || !trackList.value?.ready)
          return { ready: false, actions: [], scrollTop: 0 }
        if (snapshot.scrollTop !== undefined) trackList.value.restorePosition(snapshot.scrollTop)
        if (!previous || snapshot.scrollTop !== undefined) {
          // Reveal a newly mounted or resumed child only after its rows and scroll position paint.
          await afterPaint()
        }
      }
      return {
        ready: isCurrentDocument() && host.isConnected && trackList.value?.ready === true,
        actions: actions.splice(0),
        scrollTop: scrollElement.value?.scrollTop ?? 0,
      }
    },
    close() {
      if (disposed) return
      disposed = true
      app.unmount()
      editing.dispose()
      mask.close()
      current.value = undefined
      actions.length = 0
      if (catalogGlobal[bridgeKey] === bridge) delete catalogGlobal[bridgeKey]
    },
  }
  catalogGlobal[bridgeKey] = bridge
  return true
}
