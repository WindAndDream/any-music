import { createAppErrorState } from '@any-music/core'
import type { CatalogFilterHistorySettings as HistorySettings } from '@any-music/ui'
import { provideCatalogFilterHistory, useCatalogFilterHistory } from '@any-music/ui'
import { createCatalogTrackFilterState } from '@any-music/ui'
import { provideSettingsFeedback } from '@any-music/ui'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'

import CatalogFilterHistorySettings from '../../../src/components/settings/CatalogFilterHistorySettings.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

// Node 宿主验证区域入口、真实表单及保存事务；浮层替身不冒充浏览器焦点/视觉验证。
vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const { defineComponent: defineOverlay, h: renderOverlay } = await import('vue')
  return {
    default: defineOverlay({
      props: ['open', 'title', 'description', 'size', 'suspended', 'closeLabel'],
      emits: ['close'],
      setup:
        (props, { slots, emit }) =>
        () =>
          props.open
            ? renderOverlay(
                'section',
                {
                  role: 'dialog',
                  'data-presentation': 'desktop',
                  'data-size': props.size,
                  'data-suspended': props.suspended,
                },
                [
                  renderOverlay('h2', props.title),
                  renderOverlay('p', props.description),
                  renderOverlay(
                    'button',
                    { 'aria-label': props.closeLabel, onClick: () => emit('close') },
                    '关闭',
                  ),
                  slots.default?.(),
                  renderOverlay('footer', slots.footer?.()),
                ],
              )
            : null,
    }),
  }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const { defineComponent: defineOverlay, h: renderOverlay } = await import('vue')
  return {
    default: defineOverlay({
      props: ['open', 'title', 'description', 'size', 'suspended', 'closeLabel'],
      emits: ['close'],
      setup:
        (props, { slots, emit }) =>
        () =>
          props.open
            ? renderOverlay(
                'section',
                {
                  role: 'dialog',
                  'data-presentation': 'mobile',
                  'data-size': props.size,
                  'data-suspended': props.suspended,
                },
                [
                  renderOverlay('h2', props.title),
                  renderOverlay('p', props.description),
                  renderOverlay(
                    'button',
                    { 'aria-label': props.closeLabel, onClick: () => emit('close') },
                    '关闭',
                  ),
                  slots.default?.(),
                  renderOverlay('footer', slots.footer?.()),
                ],
              )
            : null,
    }),
  }
})

function mountSettings(isMobileLayout = false, overlayTarget?: HTMLElement) {
  const save = vi.fn()
  const saveSettings = vi.fn()
  const legacy = {
    limits: { search: 8, tags: 9, published: 10, duration: 11, platforms: 12, naming: 12 },
    collapseAfter: 4,
  }
  const props = reactive({
    isMobileLayout,
    overlayTarget,
    suspended: false,
    onDetailOpenChange: vi.fn(),
  })
  let history!: ReturnType<typeof useCatalogFilterHistory>
  let feedback!: ReturnType<typeof provideSettingsFeedback>
  const consumer = defineComponent({
    setup() {
      history = useCatalogFilterHistory()
      return () => h(CatalogFilterHistorySettings, props)
    },
  })
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        feedback = provideSettingsFeedback()
        provideCatalogFilterHistory({
          load: () => [],
          save,
          loadSettings: () => legacy,
          saveSettings,
        })
        return () => h(consumer)
      },
    }),
    {},
  )
  const input = (name: string) =>
    findCatalogElement(view.root, (node) => node.tag === 'input' && node.props.name === name)
  const group = () =>
    findCatalogElement(view.root, (node) => node.tag === 'button' && 'aria-expanded' in node.props)
  const entry = (title: string) =>
    findCatalogElement(view.root, (node) => node.props['aria-label'] === `配置${title}`)
  async function expand() {
    dispatchCatalogEvent(group(), 'onClick', false)
    await nextTick()
  }
  async function open(title: string) {
    dispatchCatalogEvent(entry(title), 'onClick', false)
    await nextTick()
  }
  async function close() {
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '返回筛选历史'),
      'onClick',
      false,
    )
    await nextTick()
  }
  async function change(name: string, value: string) {
    const field = input(name)
    field.value = value
    dispatchCatalogEvent(field, 'onInput', false)
    await nextTick()
  }
  const submit = () =>
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
      false,
    )
  return {
    feedback,
    ...view,
    history,
    legacy,
    props,
    save,
    saveSettings,
    input,
    group,
    entry,
    expand,
    open,
    close,
    change,
    submit,
  }
}

describe('CatalogFilterHistorySettings', () => {
  it('reports failed persistence in a popup and retries the same saved-in-memory draft', async () => {
    const view = mountSettings()
    await view.expand()
    await view.open('音乐列表筛选')
    expect(view.root.textContent).toContain('历史保留')
    expect(view.root.textContent).toContain('默认展示')
    await view.change('drawers-search-limit', '5')
    const error = createAppErrorState('storage-write-failed', '筛选历史设置保存失败。')
    view.saveSettings.mockReturnValueOnce(error)
    view.submit()
    await nextTick()
    expect(view.feedback.notice.value?.tone).toBe('error')
    expect(view.feedback.notice.value?.message).toContain('筛选历史设置保存失败。')
    expect(view.root.textContent).not.toContain('筛选历史设置已保存。')
    expect(view.input('drawers-search-limit').props.value).toBe(5)
    expect(view.save).toHaveBeenCalledOnce()
    view.submit()
    await nextTick()
    expect(view.feedback.notice.value?.tone).toBe('success')
    expect(view.saveSettings).toHaveBeenCalledTimes(2)
    expect(view.root.textContent).toContain('筛选历史设置已保存。')
    view.unmount()
  })

  it('renders its overlay outside the settings content and removes it on close', async () => {
    const target = new CatalogTestElement('overlay-root')
    const view = mountSettings(false, target as unknown as HTMLElement)
    await view.expand()
    await view.open('音乐列表筛选')
    expect(() => findCatalogElement(view.root, (node) => node.props.role === 'dialog')).toThrow()
    expect(findCatalogElement(target, (node) => node.tag === 'input').props.name).toBe(
      'drawers-search-limit',
    )
    dispatchCatalogEvent(
      findCatalogElement(target, (node) => node.props['aria-label'] === '返回筛选历史'),
      'onClick',
      false,
    )
    await nextTick()
    expect(() => findCatalogElement(target, (node) => node.props.role === 'dialog')).toThrow()
    expect(view.props.onDetailOpenChange).toHaveBeenLastCalledWith(false)
    view.unmount()
  })

  it('starts with collapsed features and opens only the selected region configuration', async () => {
    const view = mountSettings()
    expect(view.group().props['aria-expanded']).toBe(false)
    const regions = findCatalogElement(
      view.root,
      (node) => node.props.id === view.group().props['aria-controls'],
    )
    expect(regions.props['aria-hidden']).toBe(true)
    expect(regions.props.inert).toBe(true)
    expect(() => findCatalogElement(view.root, (node) => node.tag === 'input')).toThrow()
    await view.expand()
    expect(view.group().props['aria-expanded']).toBe(true)
    expect(regions.props['aria-hidden']).toBe(false)
    expect(regions.props.inert).toBeUndefined()
    expect(view.entry('音乐列表筛选').textContent).toContain('4 项筛选 · 默认显示 4 组')
    expect(view.entry('列表内歌曲筛选').props['aria-haspopup']).toBe('dialog')
    expect(() => findCatalogElement(view.root, (node) => node.tag === 'input')).toThrow()
    await view.open('音乐列表筛选')
    expect(view.input('drawers-search-limit').props.value).toBe(8)
    expect(view.input('drawers-published-limit').props.value).toBe(10)
    expect(view.input('drawers-collapse-after').props.value).toBe(4)
    expect(() => view.input('drawers-tags-limit')).toThrow()
    expect(() => view.input('tracks-search-limit')).toThrow()
    expect(view.props.onDetailOpenChange).toHaveBeenLastCalledWith(true)
    await view.close()
    expect(view.props.onDetailOpenChange).toHaveBeenLastCalledWith(false)
    expect(() => findCatalogElement(view.root, (node) => node.tag === 'input')).toThrow()
    await view.expand()
    expect(view.group().props['aria-expanded']).toBe(false)
    expect(regions.props['aria-hidden']).toBe(true)
    expect(regions.props.inert).toBe(true)
    view.unmount()
  })

  it.each([false, true])(
    'uses a compact configuration overlay for mobile layout %j and forwards suspension',
    async (isMobileLayout) => {
      const view = mountSettings(isMobileLayout)
      await view.expand()
      await view.open('列表内歌曲筛选')
      const dialog = findCatalogElement(view.root, (node) => node.props.role === 'dialog')
      expect(dialog.props['data-presentation']).toBe(isMobileLayout ? 'mobile' : 'desktop')
      expect(dialog.props['data-size']).toBe('compact')
      const fields = findCatalogElement(dialog, (node) => node.tag === 'fieldset')
      for (const title of ['搜索筛选', '标签筛选', '发布时间', '歌曲时长'])
        expect(fields.textContent).toContain(title)
      const form = findCatalogElement(dialog, (node) => node.tag === 'form')
      const saveButton = findCatalogElement(
        dialog,
        (node) => node.tag === 'button' && node.props.type === 'submit',
      )
      expect(saveButton.props.form).toBe(form.props.id)
      view.props.suspended = true
      await nextTick()
      expect(dialog.props['data-suspended']).toBe(true)
      view.unmount()
      expect(view.props.onDetailOpenChange).toHaveBeenLastCalledWith(false)
    },
  )

  it('saves one region without applying another draft and keeps legacy defaults intact', async () => {
    const view = mountSettings()
    const drawersHistory = view.history.forScope('catalog:drawers')
    const tracksHistory = view.history.forScope('catalog:tracks:list-id')
    const filters = {
      ...createCatalogTrackFilterState(),
      searchFilters: [{ query: '已保存的关键词' }],
    }
    drawersHistory.remember('search', filters)
    tracksHistory.remember('search', filters)
    await view.expand()
    await view.open('列表内歌曲筛选')
    await view.change('tracks-search-limit', '5')
    await view.change('tracks-duration-limit', '100')
    await view.change('tracks-collapse-after', '6')
    await view.close()
    expect(view.entry('列表内歌曲筛选').textContent).toContain('未保存')
    expect(view.entry('列表内歌曲筛选').textContent).toContain('默认显示 4 组')
    await view.open('音乐列表筛选')
    await view.change('drawers-search-limit', '0')
    await view.change('drawers-published-limit', '2')
    expect(view.saveSettings).not.toHaveBeenCalled()
    view.submit()
    await nextTick()
    expect(view.saveSettings).toHaveBeenCalledExactlyOnceWith({
      ...view.legacy,
      contexts: {
        drawers: {
          limits: { search: 0, tags: 9, published: 2, duration: 11, platforms: 12, naming: 12 },
          collapseAfter: 4,
        },
      },
    })
    expect(view.root.textContent).toContain('筛选历史设置已保存。')
    expect(view.history.forScope('catalog:drawers').settings.value.limits.search).toBe(0)
    expect(drawersHistory.entries.value).toHaveLength(0)
    expect(tracksHistory.entries.value).toHaveLength(1)
    expect(view.history.forScope('catalog:tracks:list-id').settings.value.collapseAfter).toBe(4)
    await view.close()
    await view.open('列表内歌曲筛选')
    expect(view.input('tracks-search-limit').props.value).toBe('5')
    expect(view.input('tracks-duration-limit').props.value).toBe('100')
    expect(view.input('tracks-collapse-after').props.value).toBe('6')
    view.submit()
    await nextTick()
    expect(view.saveSettings).toHaveBeenLastCalledWith({
      ...view.legacy,
      contexts: {
        drawers: {
          limits: { search: 0, tags: 9, published: 2, duration: 11, platforms: 12, naming: 12 },
          collapseAfter: 4,
        },
        tracks: {
          limits: { search: 5, tags: 9, published: 10, duration: 100, platforms: 12, naming: 12 },
          collapseAfter: 6,
        },
      },
    })
    await view.close()
    expect(view.entry('列表内歌曲筛选').textContent).toContain('默认显示 6 组')
    expect(view.entry('列表内歌曲筛选').textContent).not.toContain('未保存')
    view.unmount()
  })

  it.each(['', '-1', '1.5', '101'])(
    'rejects invalid retention input %j without saving or pruning and clears the error after correction',
    async (value) => {
      const view = mountSettings()
      await view.expand()
      await view.open('列表内歌曲筛选')
      await view.change('tracks-duration-limit', value)
      await view.change('tracks-search-limit', '0')
      view.submit()
      await nextTick()
      expect(view.saveSettings).not.toHaveBeenCalled()
      expect(view.feedback.notice.value?.tone).toBe('error')
      expect(view.save).not.toHaveBeenCalled()
      expect(view.history.settings.value).toEqual(view.legacy)
      const alert = findCatalogElement(view.root, (node) => node.props.role === 'alert')
      expect(alert.textContent).toContain('列表内歌曲筛选 · 歌曲时长')
      expect(view.input('tracks-duration-limit').props['aria-describedby']).toContain(
        alert.props.id,
      )
      await view.change('tracks-duration-limit', '3')
      expect(view.root.textContent).not.toContain('保留数量须为')
      view.submit()
      expect(view.saveSettings).toHaveBeenCalledOnce()
      view.unmount()
    },
  )

  it('keeps an invalid draft in another region while saving valid settings', async () => {
    const view = mountSettings()
    await view.expand()
    await view.open('列表内歌曲筛选')
    await view.change('tracks-search-limit', '101')
    await view.close()
    await view.open('音乐列表筛选')
    await view.change('drawers-search-limit', '2')
    view.submit()
    await nextTick()
    expect(view.saveSettings).toHaveBeenCalledOnce()
    expect(view.history.forScope('catalog:tracks:list-id').settings.value.limits.search).toBe(8)
    await view.close()
    await view.open('列表内歌曲筛选')
    expect(view.input('tracks-search-limit').props.value).toBe('101')
    expect(view.root.textContent).not.toContain('筛选历史设置已保存。')
    view.unmount()
  })

  it('rejects zero display count and synchronizes only externally changed regions', async () => {
    const view = mountSettings()
    await view.expand()
    await view.open('音乐列表筛选')
    await view.change('drawers-collapse-after', '0')
    view.submit()
    await nextTick()
    expect(view.root.textContent).toContain('音乐列表筛选：默认显示数量须为 1 至 100 的整数。')
    expect(view.saveSettings).not.toHaveBeenCalled()
    expect(view.input('drawers-collapse-after').props.value).toBe('0')
    const next: HistorySettings = {
      ...view.legacy,
      contexts: {
        tracks: {
          limits: { search: 2, tags: 3, published: 4, duration: 5, platforms: 12, naming: 12 },
          collapseAfter: 1,
        },
      },
    }
    view.history.setSettings(next)
    await nextTick()
    expect(view.input('drawers-collapse-after').props.value).toBe('0')
    await view.close()
    await view.open('列表内歌曲筛选')
    expect(view.input('tracks-search-limit').props.value).toBe(2)
    expect(view.input('tracks-collapse-after').props.value).toBe(1)
    view.unmount()
  })
})
