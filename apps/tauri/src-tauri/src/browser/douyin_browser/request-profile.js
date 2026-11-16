// Embedded pages may render the self profile without requesting it. Issue that official request
// once from the page itself, so the website's own SDK signs it and the bridge observes it.
// oxlint-disable-next-line no-unused-expressions -- Rust evaluates this expression.
;(() => {
  if (location.origin !== 'https://www.douyin.com' || document.readyState === 'loading')
    return false
  const params = new URLSearchParams({
    device_platform: 'webapp',
    aid: '6383',
    channel: 'channel_pc_web',
    pc_client_type: '1',
    version_code: '170400',
    version_name: '17.4.0',
    cookie_enabled: String(navigator.cookieEnabled),
    screen_width: String(screen.width),
    screen_height: String(screen.height),
    browser_language: navigator.language,
    browser_platform: navigator.platform,
    browser_online: String(navigator.onLine),
    platform: 'PC',
  })
  const request = new XMLHttpRequest()
  request.open('GET', `/aweme/v1/web/user/profile/self/?${params}`)
  request.withCredentials = true
  request.send()
  return true
})()
