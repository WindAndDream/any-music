// Locate a visible login/security challenge by broad semantic signals, then show only it.
// The page DOM stays intact; visibility is restored as soon as the challenge disappears.
// oxlint-disable unicorn/consistent-function-scoping -- Rust embeds this self-contained function.
// oxlint-disable-next-line no-unused-expressions -- Rust evaluates this expression.
;(isolate) => {
  const html = document.documentElement
  if (!html || !document.body) return null
  const marked = '[data-am-focus]'
  const sheets = () => document.adoptedStyleSheets.filter((sheet) => sheet.amChallenge)
  const clear = () => {
    for (const element of document.querySelectorAll(marked))
      element.removeAttribute('data-am-focus')
    html.removeAttribute('data-am-isolate')
    const owned = sheets()
    if (owned.length)
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => !owned.includes(sheet),
      )
  }
  const visible = (element) => {
    const bounds = element.getBoundingClientRect()
    if (bounds.width < 120 || bounds.height < 80) return false
    if (
      bounds.right <= 0 ||
      bounds.bottom <= 0 ||
      bounds.left >= innerWidth ||
      bounds.top >= innerHeight
    )
      return false
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current)
      if (style.display === 'none' || Number(style.opacity || 1) <= 0.05) return false
    }
    return true
  }
  const signal = /captcha|verify|verifycenter|secsdk|login-modal|login-panel|login_modal/i
  const candidates = [
    ...document.querySelectorAll(
      'iframe, [data-e2e="login-modal"], [class*="captcha"], [id*="captcha"], [class*="verify"], [id*="verify"], [class*="login-panel"], [class*="login_modal"]',
    ),
  ].filter(
    (element) =>
      signal.test(
        element instanceof HTMLIFrameElement
          ? element.src
          : `${element.id} ${element.className} ${element.getAttribute('data-e2e') ?? ''}`,
      ) && visible(element),
  )
  if (!candidates.length) {
    clear()
    return null
  }
  // Grow each match to its dialog box, stopping before a full-viewport mask or the body.
  const area = (element) => {
    const bounds = element.getBoundingClientRect()
    return bounds.width * bounds.height
  }
  const viewport = innerWidth * innerHeight
  const roots = candidates.map((element) => {
    let root = element
    while (
      root.parentElement &&
      root.parentElement !== document.body &&
      area(root.parentElement) <= Math.max(area(root) * 1.8, 1) &&
      area(root.parentElement) < viewport * 0.9
    )
      root = root.parentElement
    return root
  })
  const root = roots.reduce((best, element) => (area(element) > area(best) ? element : best))
  if (!isolate) {
    clear()
  } else {
    for (const element of document.querySelectorAll(marked))
      if (element !== root) element.removeAttribute('data-am-focus')
    root.setAttribute('data-am-focus', '')
    html.setAttribute('data-am-isolate', '')
    if (!sheets().length) {
      const sheet = new CSSStyleSheet()
      sheet.amChallenge = true
      sheet.replaceSync(
        'html[data-am-isolate],html[data-am-isolate] body{background:transparent!important;overflow:hidden!important}' +
          'html[data-am-isolate] body *{visibility:hidden!important}' +
          'html[data-am-isolate] [data-am-focus],html[data-am-isolate] [data-am-focus] *{visibility:visible!important}',
      )
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    }
    const position = getComputedStyle(root).position
    if (position !== 'fixed') root.scrollIntoView({ block: 'center', inline: 'center' })
  }
  const bounds = root.getBoundingClientRect()
  return { width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) }
}
