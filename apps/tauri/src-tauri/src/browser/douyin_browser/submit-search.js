// oxlint-disable-next-line no-unused-vars -- Rust embeds and invokes this function through CDP.
async function submitSearch(query) {
  if (location.origin !== 'https://www.douyin.com' || !/^\/jingxuan\/?$/.test(location.pathname))
    return false
  // Server-rendered controls can precede the homepage's input handlers.
  // Wait for initialization, then verify the native-input value below.
  if (document.readyState !== 'complete') return false
  // Give native insertText a task to render its new state/handler. Re-read
  // current controls because initialization or rendering may replace the nodes.
  await new Promise((resolve) => setTimeout(resolve, 0))
  const currentInputs = document.querySelectorAll('input[data-e2e="searchbar-input"]')
  const currentButtons = document.querySelectorAll('button[data-e2e="searchbar-button"]')
  if (currentInputs.length !== 1 || currentButtons.length !== 1) return false
  if (currentInputs[0].value !== query || currentInputs[0].disabled || currentButtons[0].disabled)
    return false
  if (location.origin !== 'https://www.douyin.com' || !/^\/jingxuan\/?$/.test(location.pathname))
    return false
  const bounds = currentButtons[0].getBoundingClientRect()
  const x = bounds.left + bounds.width / 2
  const y = bounds.top + bounds.height / 2
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    x < 0 ||
    y < 0 ||
    x >= innerWidth ||
    y >= innerHeight
  )
    return false
  const hit = document.elementFromPoint(x, y)
  if (!hit || !currentButtons[0].contains(hit)) return false
  // Rust dispatches the actual mouse press/release; do not synthesize button.click().
  return { x, y }
}
