;(() => {
  if (
    location.origin !== 'https://www.douyin.com' ||
    !/^(?:\/jingxuan\/?|\/(?:jingxuan\/)?search\/[^/]+\/?)$/.test(location.pathname)
  )
    return false
  // The load event can wait on slow third-party assets; hydrated controls below are
  // the readiness signal that matters, so only the parsed document is required here.
  if (document.readyState === 'loading') return false
  const inputs = document.querySelectorAll('input[data-e2e="searchbar-input"]')
  const buttons = document.querySelectorAll('button[data-e2e="searchbar-button"]')
  if (inputs.length !== 1 || buttons.length !== 1 || inputs[0].disabled) return false
  // Server-rendered controls exist before hydration; input and clicks before React
  // attaches its props are silently dropped, so wait for both controls to be owned.
  const hydrated = (node) => Object.keys(node).some((key) => key.startsWith('__reactProps$'))
  if (!hydrated(inputs[0]) || !hydrated(buttons[0])) return false
  // Native CDP insertText replaces the selected text and dispatches browser input.
  // A synthetic Event('input') can be reverted by the official controlled field.
  inputs[0].focus()
  inputs[0].select()
  return document.activeElement === inputs[0]
})()
