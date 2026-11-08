;(() => {
  if (location.origin !== 'https://www.douyin.com' || !/^\/jingxuan\/?$/.test(location.pathname))
    return false
  if (document.readyState !== 'complete') return false
  const inputs = document.querySelectorAll('input[data-e2e="searchbar-input"]')
  const buttons = document.querySelectorAll('button[data-e2e="searchbar-button"]')
  if (inputs.length !== 1 || buttons.length !== 1 || inputs[0].disabled || buttons[0].disabled)
    return false
  // Native CDP insertText replaces the selected text and dispatches browser input.
  // A synthetic Event('input') can be reverted by the official controlled field.
  inputs[0].focus()
  inputs[0].select()
  return document.activeElement === inputs[0]
})()
