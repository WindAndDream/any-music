import { createEditingSession } from '@any-music/ui'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import type { NativeProxy } from '@/features/accounts/account-runtime'
import { useProxyCreateForm } from '@/features/accounts/use-proxy-create-form'

function createForm() {
  const proxies = shallowRef<NativeProxy[]>([])
  const busy = shallowRef(false)
  const add = vi.fn(() => {
    busy.value = true
  })
  const scope = effectScope()
  const form = scope.run(() =>
    useProxyCreateForm({ proxies: () => proxies.value, busy: () => busy.value, add }),
  )!
  return { form, proxies, busy, add, scope }
}

describe('desktop proxy creation', () => {
  it('retains a pending draft across theme replacement without replay and observes a save completed while unmounted', async () => {
    const editing = createEditingSession()
    const proxies = shallowRef<NativeProxy[]>([])
    const busy = shallowRef(false)
    const add = vi.fn(() => {
      busy.value = true
    })
    const mount = () => {
      const scope = effectScope()
      const form = scope.run(() =>
        useProxyCreateForm({
          proxies: () => proxies.value,
          busy: () => busy.value,
          add,
          editing,
        }),
      )!
      return { scope, form }
    }
    let view = mount()
    view.form.name.value = 'Local test'
    view.form.url.value = 'http://localhost:7897'
    view.form.submit()
    await nextTick()
    view.scope.stop()
    view = mount()
    expect(view.form.name.value).toBe('Local test')
    expect(view.form.url.value).toBe('http://localhost:7897')
    expect(add).toHaveBeenCalledTimes(1)
    view.scope.stop()
    proxies.value = [{ id: 'saved', name: 'Local test', url: 'http://localhost:7897' }]
    busy.value = false
    view = mount()
    expect(view.form.name.value).toBe('')
    expect(view.form.url.value).toBe('')
    expect(add).toHaveBeenCalledTimes(1)
    view.form.name.value = 'New unsaved draft'
    view.scope.stop()
    editing.reset()
    view = mount()
    expect(view.form.name.value).toBe('')
    view.scope.stop()
    editing.dispose()
  })
  it('shows field errors and does not submit invalid or duplicate endpoints', () => {
    const view = createForm()
    view.form.submit()
    expect(view.form.nameError.value).toContain('1–80')
    expect(view.form.urlError.value).toContain('请填写')
    view.form.name.value = '备用代理'
    view.form.url.value = 'http://LOCALHOST:80/'
    view.proxies.value = [{ id: 'saved', name: '已保存', url: 'http://localhost:80' }]
    view.form.submit()
    expect(view.form.urlError.value).toContain('地址已存在')
    expect(view.add).not.toHaveBeenCalled()
    view.scope.stop()
  })
  it('submits normalized data once while busy and resets only after the saved snapshot arrives', async () => {
    const view = createForm()
    view.form.name.value = ' 本地代理 '
    view.form.url.value = ' SOCKS5://LOCALHOST:1080/ '
    view.form.submit()
    view.form.submit()
    expect(view.add).toHaveBeenCalledExactlyOnceWith('本地代理', 'socks5://localhost:1080')
    await nextTick()
    expect(view.form.name.value).toBe(' 本地代理 ')
    view.proxies.value = [{ id: 'saved', name: '本地代理', url: 'socks5://localhost:1080' }]
    view.busy.value = false
    await nextTick()
    expect(view.form.name.value).toBe('')
    expect(view.form.url.value).toBe('')
    expect(view.form.nameError.value).toBe('')
    expect(view.form.urlError.value).toBe('')
    view.scope.stop()
  })
  it('retains input after a failed save or an unrelated proxy change and allows retry', async () => {
    const view = createForm()
    view.form.name.value = '本地代理'
    view.form.url.value = 'http://localhost:80'
    view.form.submit()
    await nextTick()
    view.proxies.value = [{ id: 'other', name: '其他代理', url: 'http://localhost:8080' }]
    view.busy.value = false
    await nextTick()
    expect(view.form.name.value).toBe('本地代理')
    expect(view.form.url.value).toBe('http://localhost:80')
    view.form.submit()
    expect(view.add).toHaveBeenCalledTimes(2)
    view.scope.stop()
  })
})
