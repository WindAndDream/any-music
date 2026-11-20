;(() => {
  if (window !== window.top || location.origin !== 'https://www.douyin.com' || !document.body)
    return false
  if (globalThis.anyMusicSearch) return true

  const host = document.createElement('any-music-search')
  const shadow = host.attachShadow({ mode: 'closed' })
  const list = document.createElement('main')
  list.setAttribute('aria-label', '歌曲列表')
  const styles = new CSSStyleSheet()
  styles.replaceSync(`
    :host {
      all: initial;
      position: fixed; inset: 0; z-index: 2147483647; visibility: visible;
      display: block; overflow: auto;
      background: var(--viewport-bg, #f7f6f2); color: var(--viewport-text, #1a1a1f);
      font: 14px system-ui, sans-serif;
      --surface: #fff; --muted: #74747a; --hover: #f0efeb; --accent: #002fa7;
    }
    :host([hidden]) { display: none; }
    :host([data-dark]) {
      color-scheme: dark; background: var(--viewport-bg, #121116); color: var(--viewport-text, #f6f4fa);
      --surface: #1d1c23; --muted: #adaab6; --hover: #282730; --accent: #a7b9ff;
    }
    main { padding: clamp(12px, 1.5vw, 24px); display: grid; align-content: start; gap: 4px; }
    main[data-grid] { grid-template-columns: repeat(auto-fill, minmax(min(260px,100%), 1fr)); gap: 10px; }
    article {
      display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 54px;
      padding: 5px 9px; border-radius: 8px; box-sizing: border-box; background: var(--surface);
    }
    article:hover, article[data-selected] { background: var(--hover); }
    article[data-playing] .title { color: var(--accent); }
    article[data-unavailable] .title { color: var(--muted); }
    img, .artwork { width: 42px; height: 42px; flex: 0 0 42px; object-fit: cover; border-radius: 8px; }
    .artwork { display: grid; place-items: center; background: var(--hover); }
    .title { display: grid; text-align: start; flex: 1; min-width: 0; font-weight: 650; }
    .title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title small, time { font-size: 12px; color: var(--muted); }
    button {
      background: transparent; border: 0; border-radius: 6px; min-height: 30px;
      color: inherit; font: inherit; cursor: pointer; padding: 3px 6px;
    }
    button:hover { background: var(--hover); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    button[aria-pressed=true] { color: var(--accent); }
    button.more { margin: 16px auto; display: block; }
    p { text-align: center; color: var(--muted); }
  `)
  shadow.adoptedStyleSheets = [styles]
  shadow.append(list)

  let action
  let rendered = false
  let hiddenNodes = []
  let challenge
  let scrollPosition = 0
  const pageStyle = new CSSStyleSheet()
  pageStyle.replaceSync(`
    [data-am-catalog-hidden] { visibility: hidden !important; opacity: 0 !important; }
    [data-am-catalog-hidden], [data-am-catalog-hidden] * { pointer-events: none !important; }
    html[data-am-catalog-theme], html[data-am-catalog-theme] body {
      background: var(--am-catalog-challenge-bg, #f7f6f2) !important;
    }
    html[data-am-catalog-theme=dark], html[data-am-catalog-theme=dark] body {
      background: var(--am-catalog-challenge-bg, #121116) !important;
    }
    html[data-am-catalog-challenge-pending]::after {
      content: ''; position: fixed; inset: 0; z-index: 2147483647;
      background: inherit; pointer-events: none;
    }
    body[data-am-catalog-results] > :not(any-music-search) {
      visibility: hidden !important; opacity: 0 !important;
    }
  `)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageStyle]

  function restore() {
    for (const node of hiddenNodes) node.removeAttribute('data-am-catalog-hidden')
    hiddenNodes = []
    document.documentElement.removeAttribute('data-am-catalog-theme')
    document.documentElement.removeAttribute('data-am-catalog-challenge-pending')
    document.documentElement.style.removeProperty('--am-catalog-challenge-bg')
    document.body.removeAttribute('data-am-catalog-results')
    host.remove()
  }

  function hideSiblings(element) {
    for (
      let node = element;
      node?.parentElement && node !== document.body;
      node = node.parentElement
    )
      for (const sibling of node.parentElement.children) {
        if (sibling === node) continue
        sibling.setAttribute('data-am-catalog-hidden', '')
        hiddenNodes.push(sibling)
      }
  }

  function showChallenge({ dark, palette }) {
    const candidates = new Set()
    for (const match of document.querySelectorAll(
      'iframe[src*="captcha"], [class*="captcha_verify"], [id*="captcha-verify"]',
    )) {
      const region = match.closest('dialog[open], [role="dialog"], [aria-modal="true"]') ?? match
      if (!document.body.contains(region)) continue
      const rect = region.getBoundingClientRect()
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight &&
        region.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      ) {
        candidates.add(region)
      }
    }
    // The same widget can expose a container, a dialog and an iframe. Treat nested
    // matches as one region and leave the page covered until the widget is unambiguous.
    const regions = [...candidates].filter(
      (node) => ![...candidates].some((parent) => parent !== node && parent.contains(node)),
    )
    if (CSS.supports('color', palette.surface)) {
      document.documentElement.style.setProperty('--am-catalog-challenge-bg', palette.surface)
    }
    document.documentElement.setAttribute('data-am-catalog-theme', dark ? 'dark' : 'light')
    if (regions.length !== 1) {
      document.documentElement.setAttribute('data-am-catalog-challenge-pending', '')
      return false
    }
    hideSiblings(regions[0])
    return true
  }

  function applyPalette(palette) {
    for (const [key, property] of Object.entries({
      background: '--viewport-bg',
      text: '--viewport-text',
      surface: '--surface',
      muted: '--muted',
      hover: '--hover',
      accent: '--accent',
    })) {
      const value = palette[key]
      if (CSS.supports('color', value)) host.style.setProperty(property, value)
      else host.style.removeProperty(property)
    }
    if (CSS.supports('color', palette.background)) {
      for (const rule of [pageStyle.cssRules[1], pageStyle.cssRules[2]])
        rule.style.setProperty('background', palette.background, 'important')
    }
  }

  function button(label, text, type, id) {
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = text
    element.setAttribute('aria-label', label)
    element.dataset.action = type
    element.dataset.track = id
    element.addEventListener('click', (event) => {
      if (event.isTrusted) action = { type, id }
    })
    return element
  }

  function artwork(url) {
    try {
      const resolved = new URL(url, location.href)
      if (
        typeof url === 'string' &&
        url &&
        resolved.protocol === 'https:' &&
        !resolved.username &&
        !resolved.password
      ) {
        const image = document.createElement('img')
        image.alt = ''
        image.loading = 'lazy'
        image.referrerPolicy = 'no-referrer'
        image.src = resolved.href
        return image
      }
    } catch {}
    const fallback = document.createElement('span')
    fallback.className = 'artwork'
    fallback.textContent = '♫'
    return fallback
  }

  function drawRow(row, selectable) {
    const entry = document.createElement('article')
    entry.toggleAttribute('data-selected', row.selected)
    entry.toggleAttribute('data-playing', row.playing)
    entry.toggleAttribute('data-unavailable', row.unavailable)
    if (selectable) {
      const select = button('选择歌曲', row.selected ? '✓' : '□', 'select', row.id)
      select.setAttribute('aria-pressed', String(row.selected))
      entry.append(select)
    }
    entry.append(artwork(row.artwork))
    const title = button(`播放 ${row.title}`, '', 'play', row.id)
    title.className = 'title'
    const name = document.createElement('span')
    name.textContent = row.title
    const byline = document.createElement('small')
    byline.textContent = row.artist
    title.append(name, byline)
    const duration = document.createElement('time')
    duration.textContent = row.duration
    const favorite = button(
      row.favorite ? '取消喜欢' : '喜欢',
      row.favorite ? '♥' : '♡',
      'favorite',
      row.id,
    )
    favorite.setAttribute('aria-pressed', String(row.favorite))
    entry.append(title, duration, favorite, button('歌曲操作', '⋯', 'actions', row.id))
    return entry
  }

  globalThis.anyMusicSearch = {
    consume() {
      let challengeVisible = false
      if (challenge) {
        restore()
        challengeVisible = showChallenge(challenge)
      }
      const pending = action
      action = undefined
      return { action: pending, needsContent: !rendered, challengeVisible }
    },
    suspend() {
      scrollPosition = host.scrollTop
      restore()
      rendered = false
      challenge = undefined
    },
    update(content, verifying) {
      if (host.isConnected) scrollPosition = host.scrollTop
      const focus = shadow.activeElement?.dataset
      restore()
      applyPalette(content.palette)
      challenge = verifying ? content : undefined
      if (!verifying) {
        list.replaceChildren(...content.rows.map((row) => drawRow(row, content.selectable)))
        list.toggleAttribute('data-grid', content.grid)
        if (!content.rows.length) {
          const empty = document.createElement('p')
          empty.textContent = '尚未加载到歌曲'
          list.append(empty)
        }
        if (content.hasMore) {
          const more = button('加载更多', '加载更多', 'more', '')
          more.className = 'more'
          list.append(more)
        }
        host.toggleAttribute('data-dark', content.dark)
        document.body.append(host)
        document.body.setAttribute('data-am-catalog-results', '')
        host.scrollTop = scrollPosition
        if (focus) {
          for (const control of list.querySelectorAll('button[data-action]')) {
            if (control.dataset.action === focus.action && control.dataset.track === focus.track) {
              control.focus({ preventScroll: true })
              break
            }
          }
        }
      }
      rendered = true
      return this.consume()
    },
  }
  return true
})()
