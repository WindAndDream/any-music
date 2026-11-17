// oxlint-disable-next-line no-unused-vars -- Rust embeds and invokes this function through CDP.
function routeDetail(kind, id) {
  // Route an already hydrated official page to one work. The official client then renders
  // the work and requests its detail itself; no API URL is built or replayed here.
  if (location.origin !== 'https://www.douyin.com') return 'unavailable'
  const target = `/${kind}/${id}`
  // The client may serve a revisited route from memory without a new detail request.
  if (location.pathname === target) return 'unavailable'
  if (document.readyState === 'loading') return false
  // Route changes before React owns the page are ignored, like input on server-rendered controls.
  const input = document.querySelector('input[data-e2e="searchbar-input"]')
  if (!input || !Object.keys(input).some((key) => key.startsWith('__reactProps$'))) return false
  history.pushState({}, '', target)
  dispatchEvent(new PopStateEvent('popstate', { state: {} }))
  return 'routed'
}
