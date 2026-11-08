import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, shallowRef } from 'vue'

import { useSettingsNavigation } from '../../src/composables/use-settings-navigation'
import type { SettingsNavigationProps } from '../../src/product/settings-navigation'

/** 只模拟滚动容器与焦点目标，验证切页生命周期和竞态而不启动浏览器。 */
function createNavigation(
  isMobileLayout: boolean,
  initialSection?: SettingsNavigationProps['initialSection'],
) {
  const props = reactive<SettingsNavigationProps>({
    isMobileLayout,
    initialSection,
    groups: [
      {
        id: 'network',
        title: '网络与下载',
        entries: [
          { id: 'proxy', title: '请求代理', description: '', icon: 'link' },
          { id: 'downloads', title: '歌曲下载', description: '', icon: 'download' },
        ],
      },
    ],
  })
  const focusHeading = vi.fn()
  const focusEntry = vi.fn()
  const navigation = { scrollTop: 240, querySelector: vi.fn(() => ({ focus: focusEntry })) }
  const detail = { scrollTop: 120, querySelector: vi.fn(() => ({ focus: focusHeading })) }
  const scope = effectScope()
  const controller = scope.run(() =>
    useSettingsNavigation({
      props,
      navigation: shallowRef(navigation as unknown as HTMLElement),
      detail: shallowRef(detail as unknown as HTMLElement),
    }),
  )!
  return {
    props,
    controller,
    navigation,
    detail,
    focusHeading,
    focusEntry,
    stop: () => scope.stop(),
  }
}

describe('settings navigation', () => {
  it('starts at the grouped overview on mobile and the first detail on desktop', () => {
    const mobile = createNavigation(true)
    const desktop = createNavigation(false)
    expect(mobile.controller.selectedSectionId.value).toBeNull()
    expect(mobile.controller.visitedSectionIds.value).toEqual([])
    expect(desktop.controller.selectedSectionId.value).toBe('proxy')
    expect(desktop.controller.visitedSectionIds.value).toEqual(['proxy'])
    mobile.stop()
    desktop.stop()
  })

  it('restores overview scroll/focus and retains visited forms for draft preservation', async () => {
    const view = createNavigation(true)
    await view.controller.openSection('proxy')
    expect(view.detail.scrollTop).toBe(0)
    expect(view.focusHeading).toHaveBeenCalledOnce()
    view.navigation.scrollTop = 0
    await view.controller.returnToOverview()
    expect(view.navigation.scrollTop).toBe(240)
    expect(view.navigation.querySelector).toHaveBeenCalledWith('[data-settings-entry="proxy"]')
    expect(view.focusEntry).toHaveBeenCalledOnce()
    expect(view.controller.selectedSectionId.value).toBeNull()
    expect(view.controller.displayedSectionId.value).toBe('proxy')
    await view.controller.openSection('downloads')
    await view.controller.openSection('proxy')
    expect(view.controller.visitedSectionIds.value).toEqual(['proxy', 'downloads'])
    view.stop()
  })

  it('supports the appearance shortcut contract, breakpoint changes, and an absent capability', async () => {
    const view = createNavigation(true, 'downloads')
    expect(view.controller.selectedSectionId.value).toBe('downloads')
    view.props.initialSection = 'appearance'
    await nextTick()
    expect(view.controller.selectedSectionId.value).toBeNull()
    view.props.isMobileLayout = false
    await nextTick()
    expect(view.controller.selectedSectionId.value).toBe('proxy')
    view.props.isMobileLayout = true
    await nextTick()
    expect(view.controller.selectedSectionId.value).toBe('proxy')
    view.stop()
  })

  it('ignores stale focus work after a rapid return or scope disposal', async () => {
    const view = createNavigation(true)
    const opening = view.controller.openSection('proxy')
    const returning = view.controller.returnToOverview()
    await Promise.all([opening, returning])
    expect(view.focusHeading).not.toHaveBeenCalled()
    expect(view.focusEntry).toHaveBeenCalledOnce()
    const reopening = view.controller.openSection('downloads')
    view.stop()
    await reopening
    expect(view.focusHeading).not.toHaveBeenCalled()
  })
})
