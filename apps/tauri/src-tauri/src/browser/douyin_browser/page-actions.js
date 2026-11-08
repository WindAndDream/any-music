/** Fixed semantic DOM operations only. Unknown or ambiguous controls require a visible handoff. */
// oxlint-disable unicorn/consistent-function-scoping -- Rust injects this self-contained function.
export default async function loginPageAction(action, code) {
  if (location.origin !== 'https://www.douyin.com') return { ok: false }
  const visible = (element) => {
    const style = getComputedStyle(element)
    return (
      !element.closest('[hidden], [aria-hidden="true"]') &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      element.getClientRects().length > 0
    )
  }
  const panels = [
    ...document.querySelectorAll('article, [role="dialog"], section[aria-label="短信验证"]'),
  ]
    .filter(visible)
    .filter((element) =>
      /身份验证|短信验证/.test(
        element.getAttribute('aria-label') || element.innerText || element.textContent || '',
      ),
    )
  const distinctPanels = panels.filter(
    (element) => !panels.some((child) => child !== element && element.contains(child)),
  )
  // QR login remains mounted behind MFA. Never click its send control or inject into its input.
  if (action !== 'login' && distinctPanels.length !== 1) return { ok: false }
  const root = action === 'login' ? document : distinctPanels[0]
  const controls = [
    ...root.querySelectorAll('button, [role="button"], a, [tabindex], div, span'),
  ].filter(visible)
  const label = (element) =>
    (element.getAttribute('aria-label') || element.innerText || element.textContent || '').replace(
      /\s+/g,
      '',
    )
  const find = (labels, allowDisabled = false, scope = controls) => {
    const candidates = scope.filter(
      (element) =>
        (allowDisabled ||
          (!element.disabled && element.getAttribute('aria-disabled') !== 'true')) &&
        labels.includes(label(element)),
    )
    // Official React buttons may wrap a text span. Click the unique deepest match so bubbling
    // reaches its handler without confusing an ancestor wrapper with a second control.
    const matches = candidates.filter(
      (element) => !candidates.some((child) => child !== element && element.contains(child)),
    )
    return matches.length === 1 ? matches[0] : undefined
  }
  if (action === 'inspect') {
    const text = root.innerText || root.textContent || ''
    const mobile = text.match(/1\d{2}\*{4,}\d{4}/)?.[0] || ''
    const countdown = text.match(/(?:重新发送|重新获取|重发)[^\d]{0,8}(\d{1,3})\s*[s秒]/i)?.[1]
    return { ok: true, maskedMobile: mobile, retryAfter: Math.min(600, Number(countdown || 0)) }
  }
  if (action === 'login') {
    // A mounted phone-login panel may expose a second "登录" label. Prefer the
    // QR tab, then a unique semantic entry, before considering generic wrappers.
    const labels = ['登录', '登录/注册', '登录注册']
    const control =
      find(['扫码登录']) ||
      find(
        labels,
        false,
        controls.filter((element) => element.matches('button, [role="button"], a, [tabindex]')),
      ) ||
      find(labels)
    if (!control) return { ok: false }
    control.click()
    return { ok: true }
  }
  if (action === 'send') {
    const control =
      find(['接收短信验证码', '接收短信验证']) ||
      find(['获取验证码', '发送验证码', '重新发送', '重新获取'])
    if (!control) return { ok: false }
    control.click()
    return { ok: true }
  }
  if (action === 'submit') {
    if (!/^\d{6}$/.test(code || '')) return { ok: false }
    const inputs = [...root.querySelectorAll('input')].filter(
      (input) =>
        visible(input) &&
        !input.disabled &&
        (input.autocomplete === 'one-time-code' ||
          /验证码/.test(input.placeholder || input.getAttribute('aria-label') || '')),
    )
    const labels = ['验证', '确认', '确定', '提交', '确认验证']
    const control = find(labels, true)
    if (inputs.length !== 1 || !control) return { ok: false }
    const input = inputs[0]
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!set) return { ok: false }
    set.call(input, code)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    // React enables the submit control after processing the injected input event.
    // A background desktop may throttle animation frames; use one event-loop turn.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const enabled = find(labels)
    if (!enabled) return { ok: false }
    enabled.click()
    return { ok: true }
  }
  return { ok: false }
}
