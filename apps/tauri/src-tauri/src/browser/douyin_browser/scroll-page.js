;(() => {
  if (
    location.origin !== 'https://www.douyin.com' ||
    !/^\/(?:(?:jingxuan\/)?search\/|user\/self(?:\/|$)|collection\/\d+)/.test(location.pathname)
  )
    return null
  // Jingxuan result cards can be clickable containers without video/note links.
  // Follow the official result list before the legacy links, avoiding unrelated sidebars.
  const content =
    document.querySelector('[data-e2e="scroll-list"]') ??
    document.querySelector('a[href*="/video/"], a[href*="/note/"]')
  let element = content?.parentElement
  while (element) {
    if (
      element.clientHeight >= 240 &&
      element.scrollHeight > element.clientHeight + 120 &&
      /auto|scroll/.test(getComputedStyle(element).overflowY)
    )
      break
    element = element.parentElement
  }
  const container = element ?? document.scrollingElement
  if (!container) return null
  // Only measure here. Rust sends bounded browser-native wheel input and owns its
  // timing/cancellation; no page animation can outlive a pending consumer read.
  const bounds = element
    ? element.getBoundingClientRect()
    : { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
  const left = Math.max(bounds.left, 0) + 12
  const right = Math.min(bounds.right, innerWidth) - 12
  const top = Math.max(bounds.top, 0) + 12
  const bottom = Math.min(bounds.bottom, innerHeight) - 12
  if (right <= left || bottom <= top) return null
  for (const [horizontal, vertical] of [
    [0.5, 0.65],
    [0.5, 0.45],
    [0.35, 0.65],
    [0.65, 0.65],
  ]) {
    const x = left + (right - left) * horizontal
    const y = top + (bottom - top) * vertical
    const hit = document.elementFromPoint(x, y)
    if (!hit || !container.contains(hit)) continue
    // A nested scroll area or overlay must not receive the result-list wheel.
    let current = hit
    while (current && current !== container) {
      if (
        current.scrollHeight > current.clientHeight + 1 &&
        /auto|scroll/.test(getComputedStyle(current).overflowY)
      )
        break
      current = current.parentElement
    }
    if (current !== container) continue
    return {
      x,
      y,
      viewportHeight: bottom - top,
      remaining: Math.max(0, container.scrollHeight - container.clientHeight - container.scrollTop),
    }
  }
  // Do not redirect wheel input to the window when a content container is occluded.
  return null
})()
