import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { useAppShell } from '../../src/composables/use-app-shell'
import { createDefaultAppShellPreferences } from '../../src/product/app-shell-preferences'

function createMediaQueryList(matches: boolean): MediaQueryList {
  return {
    matches,
    media: '',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }
}

/** 只派发断点变化，测试响应式状态及订阅清理，不启动浏览器。 */
function changeMediaQuery(query: MediaQueryList, matches: boolean): void {
  for (const [, listener] of vi.mocked(query.addEventListener).mock.calls) {
    if (typeof listener === 'function') listener.call(query, { matches } as MediaQueryListEvent)
  }
}

describe('useAppShell', () => {
  it.each([false, true])(
    'lets the first medium-viewport toggle expand with persisted collapse=%s',
    async (isSidebarCollapsed) => {
      const preferences = { ...createDefaultAppShellPreferences(), isSidebarCollapsed }
      const save = vi.fn()
      const scope = effectScope()
      const shell = scope.run(() =>
        useAppShell({
          preferencesRepository: { load: () => preferences, save },
          matchMedia: (query) => createMediaQueryList(query === '(max-width: 1024px)'),
        }),
      )!

      expect(shell.effectiveSidebarCollapsed.value).toBe(true)
      shell.toggleSidebarCollapsed()
      expect(shell.effectiveSidebarCollapsed.value).toBe(false)
      expect(shell.isSidebarCollapsed.value).toBe(false)

      shell.toggleSidebarCollapsed()
      await nextTick()
      expect(shell.effectiveSidebarCollapsed.value).toBe(true)
      expect(shell.isSidebarCollapsed.value).toBe(true)
      if (!isSidebarCollapsed) {
        expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ isSidebarCollapsed: true }))
      }
      scope.stop()
    },
  )

  it('resets medium overrides across breakpoints without persisting automatic collapse', async () => {
    const preferences = { ...createDefaultAppShellPreferences(), isSidebarCollapsed: true }
    const save = vi.fn()
    const mediumQuery = createMediaQueryList(true)
    const mobileQuery = createMediaQueryList(false)
    const scope = effectScope()
    const shell = scope.run(() =>
      useAppShell({
        preferencesRepository: { load: () => preferences, save },
        matchMedia: (query) => {
          if (query === '(max-width: 1024px)') return mediumQuery
          if (query === '(max-width: 768px)') return mobileQuery
          return createMediaQueryList(false)
        },
      }),
    )!

    shell.toggleSidebarCollapsed()
    await nextTick()
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ isSidebarCollapsed: false }))
    save.mockClear()

    changeMediaQuery(mediumQuery, false)
    expect(shell.effectiveSidebarCollapsed.value).toBe(false)
    changeMediaQuery(mediumQuery, true)
    expect(shell.effectiveSidebarCollapsed.value).toBe(true)
    shell.toggleSidebarCollapsed()
    expect(shell.effectiveSidebarCollapsed.value).toBe(false)

    changeMediaQuery(mobileQuery, true)
    shell.toggleMobileDrawer()
    shell.toggleSidebarCollapsed()
    expect(shell.isMobileDrawerOpen.value).toBe(false)
    expect(shell.effectiveSidebarCollapsed.value).toBe(false)
    changeMediaQuery(mobileQuery, false)
    expect(shell.effectiveSidebarCollapsed.value).toBe(true)
    expect(shell.isSidebarCollapsed.value).toBe(false)
    await nextTick()
    expect(save).not.toHaveBeenCalled()

    scope.stop()
    expect(mediumQuery.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(mobileQuery.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('keeps desktop content interactive when a drawer toggle is requested', () => {
    const preferences = createDefaultAppShellPreferences()
    const scope = effectScope()
    const shell = scope.run(() =>
      useAppShell({
        preferencesRepository: { load: () => preferences, save: vi.fn() },
        matchMedia: () => createMediaQueryList(false),
      }),
    )

    shell!.toggleMobileDrawer()

    expect(shell!.isMobileDrawerOpen.value).toBe(false)
    scope.stop()
  })

  it('updates the persisted sidebar direction without coupling content placement state', () => {
    const preferences = createDefaultAppShellPreferences()
    const scope = effectScope()
    const shell = scope.run(() =>
      useAppShell({
        preferencesRepository: { load: () => preferences, save: vi.fn() },
        matchMedia: () => createMediaQueryList(false),
      }),
    )

    expect(shell!.sidebarSide.value).toBe('left')

    shell!.setSidebarSide('right')

    expect(shell!.sidebarSide.value).toBe('right')
    scope.stop()
  })

  it('closes the mobile drawer without changing the persisted desktop collapse preference', () => {
    const preferences = createDefaultAppShellPreferences()
    const save = vi.fn()
    const scope = effectScope()
    const shell = scope.run(() =>
      useAppShell({
        preferencesRepository: { load: () => preferences, save },
        matchMedia: (query) => createMediaQueryList(query === '(max-width: 768px)'),
      }),
    )

    expect(shell).toBeDefined()
    shell!.toggleMobileDrawer()
    expect(shell!.isMobileDrawerOpen.value).toBe(true)

    shell!.toggleSidebarCollapsed()

    expect(shell!.isMobileDrawerOpen.value).toBe(false)
    expect(shell!.isSidebarCollapsed.value).toBe(false)
    expect(save).not.toHaveBeenCalled()
    scope.stop()
  })
})
