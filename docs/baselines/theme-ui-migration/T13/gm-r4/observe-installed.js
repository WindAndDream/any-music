// Read-only installed-GM UI observations. No credentials, private titles or media URLs.
;(() => {
  const walk = (root) =>
    [...root.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? walk(e.shadowRoot) : [])])
  const active = () => {
    let e = document.activeElement
    while (e?.shadowRoot?.activeElement) e = e.shadowRoot.activeElement
    return e
  }
  const visible = (e) =>
    e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible'
  const firstAudio = walk(document).find((e) => e.tagName === 'AUDIO')
  let controller, themeHost
  const seen = new Set()
  const visit = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    if (v.component) {
      const c = v.component
      if (c.type.__name === 'MusicWorkbenchThemeHost') controller = c.props.controller
      if (c.type.__name === 'ThemeHost') themeHost = c
      visit(c.subTree)
    }
    if (Array.isArray(v.children)) v.children.forEach(visit)
    if (Array.isArray(v.dynamicChildren)) v.dynamicChildren.forEach(visit)
  }
  const app = walk(document).find((e) => e.__vue_app__).__vue_app__
  visit(app._container._vnode)
  window.__amR4 = {
    walk,
    active,
    controller,
    get features() {
      return themeHost.props.features
    },
    observations: [],
    sample(label) {
      const es = walk(document),
        a = active(),
        root = es.find((e) => e.hasAttribute('data-am-theme-root'))
      const audio = es.filter((e) => e.tagName === 'AUDIO')
      const value = {
        label,
        at: new Date().toISOString(),
        viewport: {
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
          touch: navigator.maxTouchPoints,
          dark: matchMedia('(prefers-color-scheme: dark)').matches,
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        },
        theme: root?.dataset.amUiTheme,
        resolved: root?.dataset.amTheme,
        appearance: themeHost.props.features.settings.state.appearance,
        focus: {
          tag: a?.tagName,
          key: a?.dataset.amFocusKey,
          label:
            a?.getAttribute('aria-label') ||
            [...(a?.labels || [])][0]?.textContent.trim() ||
            a?.textContent?.trim().slice(0, 55),
        },
        audio: {
          count: audio.length,
          sameReference: audio[0] === firstAudio,
          paused: audio[0]?.paused,
          hasSource: !!audio[0]?.currentSrc,
          time: audio[0]?.currentTime,
        },
        scroll: es
          .filter((e) => e.hasAttribute('data-am-scroll-key'))
          .map((e) => ({
            key: e.dataset.amScrollKey,
            top: e.scrollTop,
            height: e.clientHeight,
            total: e.scrollHeight,
            width: e.clientWidth,
            totalWidth: e.scrollWidth,
          })),
        dialogs: es
          .filter((e) => e.getAttribute('role') === 'dialog' && visible(e))
          .map((e) => ({
            label: e.getAttribute('aria-label'),
            width: e.getBoundingClientRect().width,
            height: e.getBoundingClientRect().height,
          })),
        protectedSurfaces: es
          .filter((e) => e.hasAttribute('data-am-host-surface'))
          .map((e) => ({
            type: e.dataset.amHostSurface,
            styles: e.shadowRoot?.querySelectorAll('style').length,
          })),
        hostStyleCount: document.querySelectorAll('style,link[rel=stylesheet]').length,
        themeRootCount: es.filter((e) => e.hasAttribute('data-am-theme-root')).length,
      }
      this.observations.push(value)
      return value
    },
  }
  return window.__amR4.sample('installed-initial')
})()
