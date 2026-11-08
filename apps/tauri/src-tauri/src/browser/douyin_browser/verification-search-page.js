// oxlint-disable-next-line no-unused-vars -- Rust embeds and invokes this function through CDP.
function verificationSearchPage(query, challenge) {
  if (location.origin !== 'https://www.douyin.com' || challenge) return 'waiting'
  const path = location.pathname
  if (/^\/jingxuan\/?$/.test(path)) return 'ready'
  const match = /^\/(?:jingxuan\/)?search\/(.+?)\/?$/.exec(path)
  try {
    if (match && decodeURIComponent(match[1]) === query) return 'submitted'
  } catch {
    return 'waiting'
  }
  // Wait for login's own redirects to finish before choosing a different page.
  return document.readyState === 'complete' ? 'navigate' : 'waiting'
}
