import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Exercise the exact shipped bridge with a small DOM fixture; no browser or network is started.
const source = readFileSync(
  new URL('../../../src-tauri/src/browser/douyin_browser/page-actions.js', import.meta.url),
  'utf8',
)
const fixture = readFileSync(
  new URL('../../fixtures/login-experiment-page.html', import.meta.url),
  'utf8',
)
interface Control {
  disabled: boolean
  placeholder?: string
  autocomplete?: string
  value?: string
  textContent: string
  getAttribute: (name: string) => string | null
  closest: () => null
  contains: (child: Control) => boolean
  matches: (selector: string) => boolean
  getClientRects: () => number[]
  click: ReturnType<typeof vi.fn>
  dispatchEvent: ReturnType<typeof vi.fn>
}
let controls: Control[]
let verificationControls: Control[]
let input: Control
function control(label: string): Control {
  return {
    disabled: false,
    textContent: label,
    getAttribute: () => null,
    closest: () => null,
    contains: () => false,
    matches: () => true,
    getClientRects: () => [1],
    click: vi.fn(),
    dispatchEvent: vi.fn(),
  }
}
const bridge = new Function(`return (${source.replace('export default ', '')})`)() as (
  action: string,
  code?: string,
) => Promise<{ ok: boolean; maskedMobile?: string }>
beforeEach(() => {
  controls = [...fixture.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) =>
    control(match[1]!),
  )
  verificationControls = controls.slice(1)
  const tag = fixture.match(/<input[^>]+>/)![0]
  input = {
    ...control(''),
    autocomplete: tag.match(/autocomplete="([^"]+)"/)![1],
    placeholder: tag.match(/placeholder="([^"]+)"/)![1],
  }
  class Input {
    set value(value: string) {
      ;(this as unknown as Control).value = value
    }
  }
  vi.stubGlobal('HTMLInputElement', Input)
  vi.stubGlobal('location', { origin: 'https://www.douyin.com' })
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' }))
  vi.stubGlobal('document', {
    body: { innerText: '验证码发送至 138****5678 private' },
    querySelectorAll: (selector: string) => {
      if (selector.startsWith('article'))
        return [
          {
            ...control('身份验证 验证码发送至 138****5678 private'),
            querySelectorAll: (nestedSelector: string) =>
              nestedSelector === 'input' ? [input] : verificationControls,
          },
        ]
      return selector === 'input' ? [input] : controls
    },
  })
})
afterEach(() => vi.unstubAllGlobals())
describe('official login DOM bridge', () => {
  it('operates inside MFA while the ordinary login controls remain mounted', async () => {
    const ordinarySend = control('获取验证码')
    const ordinarySubmit = control('确认')
    controls.push(ordinarySend, ordinarySubmit)
    expect((await bridge('send')).ok).toBe(true)
    expect(controls[1]!.click).toHaveBeenCalledOnce()
    expect(ordinarySend.click).not.toHaveBeenCalled()
    expect((await bridge('submit', '123456')).ok).toBe(true)
    expect(ordinarySubmit.click).not.toHaveBeenCalled()
  })
  it('acts only on unique controls and projects masked text', async () => {
    expect((await bridge('login')).ok).toBe(true)
    expect(controls[0]!.click).toHaveBeenCalledOnce()
    controls.push(control('登录'))
    expect((await bridge('login')).ok).toBe(false)
    expect(await bridge('inspect')).toMatchObject({ maskedMobile: '138****5678' })
    expect(JSON.stringify(await bridge('inspect'))).not.toContain('private')
  })
  it('submits only six digits and dispatches input events before clicking', async () => {
    expect((await bridge('submit', '12')).ok).toBe(false)
    controls[2]!.disabled = true
    input.dispatchEvent.mockImplementation(() => {
      controls[2]!.disabled = false
    })
    expect((await bridge('submit', '123456')).ok).toBe(true)
    expect(input.value).toBe('123456')
    expect(input.dispatchEvent).toHaveBeenCalledTimes(2)
    expect(controls[2]!.click).toHaveBeenCalledOnce()
  })
  it('opens the QR tab when the mounted panel defaults to phone login', async () => {
    const qrTab = control('扫码登录')
    controls.push(qrTab, control('登录'))
    expect((await bridge('login')).ok).toBe(true)
    expect(qrTab.click).toHaveBeenCalledOnce()
    expect(controls[0]!.click).not.toHaveBeenCalled()
  })
  it('uses a unique semantic login entry despite unrelated matching text', async () => {
    const duplicateText = control('登录')
    duplicateText.matches = () => false
    controls.push(duplicateText)
    expect((await bridge('login')).ok).toBe(true)
    expect(controls[0]!.click).toHaveBeenCalledOnce()
    expect(duplicateText.click).not.toHaveBeenCalled()
  })
  it('rejects other origins and disabled controls without side effects', async () => {
    vi.stubGlobal('location', { origin: 'https://evil.com' })
    expect((await bridge('send')).ok).toBe(false)
    vi.stubGlobal('location', { origin: 'https://www.douyin.com' })
    controls[1]!.disabled = true
    expect((await bridge('send')).ok).toBe(false)
    expect(controls[1]!.click).not.toHaveBeenCalled()
  })
})
