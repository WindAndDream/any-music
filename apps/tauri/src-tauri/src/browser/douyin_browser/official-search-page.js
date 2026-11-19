// oxlint-disable-next-line no-unused-vars -- The native account actor invokes this expression.
function officialSearchPage(query, received, challenge) {
  if (location.origin === 'https://login.douyin.com') return 'challenge'
  if (location.origin !== 'https://www.douyin.com') return null
  if (challenge) return 'challenge'
  const result = /^\/(?:jingxuan\/)?search\/(.+?)\/?$/.exec(location.pathname)
  if (result && decodeURIComponent(result[1]) === query)
    return received || document.querySelector('[data-e2e="scroll-list"]')?.childElementCount
      ? 'show'
      : null
  if (/^\/jingxuan\/?$/.test(location.pathname)) return 'submit'
  return null
}
