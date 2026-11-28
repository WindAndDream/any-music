import type { CatalogOverlayOpener, CatalogViewportContext } from '../../product/theme-contracts'

/** A native list can yield its viewport before the theme opens a dialog. */
export function useCatalogViewportOverlay() {
  let current: CatalogOverlayOpener | undefined
  const registerOverlayOpener: CatalogViewportContext['registerOverlayOpener'] = (opener) => {
    current = opener
    return () => {
      if (current === opener) current = undefined
    }
  }
  function openOverlay(open: () => void): void {
    if (current) current(open)
    else open()
  }
  return { openOverlay, registerOverlayOpener }
}
