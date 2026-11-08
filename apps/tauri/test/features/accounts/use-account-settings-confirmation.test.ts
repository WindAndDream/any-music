import { BottomSheet, provideBackNavigation } from '@any-music/ui'
import type { BackNavigation } from '@any-music/ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, effectScope, h, shallowRef } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { useAccountSettingsConfirmation } from '@/features/accounts/use-account-settings-confirmation'

const request = { title: '删除账号', message: '确认删除当前账号？' }
afterEach(() => vi.unstubAllGlobals())

function setup() {
  const detailOpen = shallowRef(true)
  const suspended = shallowRef(false)
  const scope = effectScope()
  const confirmation = scope.run(() => useAccountSettingsConfirmation({ detailOpen, suspended }))!
  return { detailOpen, suspended, scope, confirmation }
}

describe('protected account confirmation lifecycle', () => {
  it.each(['close', 'suspend', 'dispose'] as const)(
    'cancels the pending deletion on %s without retaining it for another dialog',
    async (action) => {
      const f = setup()
      try {
        const result = f.confirmation.confirm(request)
        if (action === 'close') f.detailOpen.value = false
        else if (action === 'suspend') f.suspended.value = true
        else f.scope.stop()
        await expect(result).resolves.toBe(false)
        expect(f.confirmation.activeRequest.value).toBeUndefined()
        f.confirmation.accept()
        await expect(f.confirmation.confirm(request)).resolves.toBe(false)
        if (action === 'dispose') {
          expect(f.confirmation.activeRequest.value).toBeUndefined()
        } else {
          f.detailOpen.value = true
          f.suspended.value = false
          const next = f.confirmation.confirm(request)
          f.confirmation.accept()
          await expect(next).resolves.toBe(true)
        }
      } finally {
        f.scope.stop()
      }
    },
  )

  it('consumes system Back in the confirmation before returning to account details', async () => {
    vi.stubGlobal('window', new EventTarget())
    let back!: BackNavigation
    let confirmation!: ReturnType<typeof useAccountSettingsConfirmation>
    let result!: Promise<boolean>
    let firstBack = false
    let secondBack = false
    const child = defineComponent({
      setup() {
        confirmation = useAccountSettingsConfirmation({ detailOpen: true, suspended: false })
        result = confirmation.confirm(request)
        firstBack = back.back()
        secondBack = back.back()
        return () => h('div')
      },
    })
    try {
      await renderToString(
        createSSRApp({
          setup() {
            back = provideBackNavigation()
            return () =>
              h(
                BottomSheet,
                { open: true, title: '设置', suspended: true },
                { default: () => h(child) },
              )
          },
        }),
      )
      expect(firstBack).toBe(true)
      await expect(result).resolves.toBe(false)
      expect(secondBack).toBe(false)
    } finally {
      confirmation?.dispose()
    }
  })
})
