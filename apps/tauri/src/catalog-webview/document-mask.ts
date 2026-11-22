/** Suppress paint/focus without detaching the official page or changing its layout. */
export function createCatalogDocumentMask(host: HTMLElement, lease: string) {
  const masked = new Set<Element>()
  const document = host.ownerDocument
  const originalBody = document.body
  function maskOriginalChild(element: Element) {
    if (element.hasAttribute('data-am-catalog-host') || masked.has(element)) return
    if (['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)) return
    if (element.hasAttribute('inert') && !element.hasAttribute('data-am-catalog-inert')) return
    element.setAttribute('inert', '')
    element.setAttribute('data-am-catalog-inert', lease)
    masked.add(element)
  }
  function restore(node: Element) {
    if (node.getAttribute('data-am-catalog-inert') !== lease) return
    node.removeAttribute('inert')
    node.removeAttribute('data-am-catalog-inert')
  }
  const observeOriginal = new MutationObserver((records) => {
    for (const { addedNodes, removedNodes } of records) {
      for (const node of removedNodes) {
        if (node instanceof Element && node.parentElement !== originalBody && masked.delete(node))
          restore(node)
      }
      for (const node of addedNodes) {
        if (node instanceof Element && node.parentElement === originalBody) maskOriginalChild(node)
      }
    }
  })

  const documentStyles = new CSSStyleSheet()
  documentStyles.replaceSync(`
  html[data-am-catalog-document] { background: transparent !important; }
  html[data-am-catalog-document] > body { background: transparent !important; scrollbar-width: none; }
  html[data-am-catalog-document] > body > :not([data-am-catalog-host]) {
    opacity: 0 !important;
    pointer-events: none !important;
  }
  html[data-am-catalog-document] > body > :not([data-am-catalog-host]):is(img, video, canvas),
  html[data-am-catalog-document] > body > :not([data-am-catalog-host]) :is(img, video, canvas) {
    /* Suppress media paint while preserving the result tree's layout and visibility checks. */
    visibility: hidden !important;
  }
  html[data-am-catalog-document]::before, html[data-am-catalog-document]::after,
  html[data-am-catalog-document] > body::before, html[data-am-catalog-document] > body::after {
    visibility: hidden !important;
  }
  [data-am-catalog-host] {
    all: initial !important;
    display: block !important;
    position: fixed !important;
    inset: 0 !important;
    z-index: 2147483647 !important;
    visibility: visible !important;
  }
  `)

  let active = false
  return {
    hasOriginalBody: () => document.body === originalBody,
    show() {
      if (!host.isConnected) originalBody.append(host)
      if (active) return
      active = true
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, documentStyles]
      document.documentElement.dataset.amCatalogDocument = lease
      for (const element of originalBody.children) maskOriginalChild(element)
      observeOriginal.observe(originalBody, { childList: true })
    },
    close() {
      observeOriginal.disconnect()
      for (const node of masked) restore(node)
      masked.clear()
      host.remove()
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => sheet !== documentStyles,
      )
      if (document.documentElement.dataset.amCatalogDocument === lease)
        delete document.documentElement.dataset.amCatalogDocument
    },
  }
}
