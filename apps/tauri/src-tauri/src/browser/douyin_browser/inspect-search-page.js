;(() => {
  const width = innerWidth
  const height = innerHeight
  const visible = (element) => {
    const bounds = element.getBoundingClientRect()
    if (
      bounds.width < 8 ||
      bounds.height < 8 ||
      bounds.right <= 0 ||
      bounds.bottom <= 0 ||
      bounds.left >= width ||
      bounds.top >= height
    )
      return false
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity || 1) <= 0
      )
        return false
    }
    return true
  }
  if (location.origin !== 'https://www.douyin.com') return null
  const path = new URL(location.href).pathname.toLowerCase()
  // Search terms are URL path segments too; searching for "captcha" is not a challenge.
  if (!/^\/(?:jingxuan\/)?search\//.test(path) && /captcha|\/verify/.test(path))
    return 'verification-required'
  if (
    [
      ...document.querySelectorAll(
        'iframe[src*="captcha"], [class*="captcha_verify"], [id*="captcha-verify"]',
      ),
    ].some(visible)
  )
    return 'verification-required'
  if (
    [...document.querySelectorAll('[data-e2e="login-modal"], [class*="login-panel"]')].some(visible)
  )
    // Rust must reconcile this page signal with the same account's HttpOnly cookies.
    return 'login-required'
  return null
})()
