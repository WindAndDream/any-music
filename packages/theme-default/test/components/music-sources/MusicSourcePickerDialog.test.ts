import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import MusicSourcePickerButton from '../../../src/components/music-sources/MusicSourcePickerButton.vue'
import MusicSourcePickerDialog from '../../../src/components/music-sources/MusicSourcePickerDialog.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

// 仅替换模态宿主，执行真实选择按钮及受控开关；焦点行为由 AppDialog 管理。
vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: ['open'],
      emits: ['close'],
      setup:
        (props, { slots, emit }) =>
        () =>
          props.open
            ? h('section', [
                h('button', { 'aria-label': '关闭', onClick: () => emit('close') }, '关闭'),
                slots.default?.(),
              ])
            : null,
    }),
  }
})

describe('MusicSourcePickerDialog', () => {
  it('filters names locally, shows no-match feedback, and resets the search on reopening', async () => {
    const onSelect = vi.fn()
    const props = reactive({
      open: true,
      activeSourceId: 'bilibili',
      builtInSources: [
        { id: 'bilibili', name: '哔哩哔哩' },
        { id: 'douyin', name: '抖音' },
      ],
      externalSources: [{ id: 'external', name: 'My Music' }],
      onSelect,
    })
    const view = mountCatalogComponent(MusicSourcePickerDialog, props)
    const input = () => findCatalogElement(view.root, (node) => node.tag === 'input')
    const typeQuery = async (query: string) => {
      input().value = query
      input().dispatchListeners('input', { target: input() })
      await nextTick()
    }
    await typeQuery('哔哩')
    expect(view.root.textContent).toContain('哔哩哔哩')
    expect(view.root.textContent).not.toContain('抖音')
    expect(view.root.textContent).not.toContain('自定义音乐源')
    await typeQuery('  ＭＹ  ')
    expect(view.root.textContent).toContain('My Music')
    expect(view.root.textContent).not.toContain('内置音乐源')
    await typeQuery('找不到的平台')
    expect(view.root.textContent).toContain('没有匹配的音乐平台')
    expect(onSelect).not.toHaveBeenCalled()
    props.open = false
    await nextTick()
    props.open = true
    await nextTick()
    expect(input().value).toBe('')
    expect(view.root.textContent).toContain('哔哩哔哩')
    expect(view.root.textContent).toContain('My Music')
    view.unmount()
  })

  it('opens from an accessible platform button and selects an external source before closing', async () => {
    const events: string[] = []
    const props = reactive({
      open: false,
      activeSourceId: 'bilibili',
      builtInSources: [{ id: 'bilibili', name: '哔哩哔哩' }],
      externalSources: [{ id: 'external', name: '我的平台' }],
      onSelect: (id: string) => events.push(id),
      onClose: () => {
        events.push('close')
        props.open = false
      },
    })
    const trigger = mountCatalogComponent(MusicSourcePickerButton, {
      sourceName: '哔哩哔哩',
      expanded: false,
      onOpen: () => {
        props.open = true
      },
    })
    const view = mountCatalogComponent(MusicSourcePickerDialog, props)
    const button = findCatalogElement(trigger.root, (node) => node.tag === 'button')
    expect(button.props['aria-haspopup']).toBe('dialog')
    expect(button.props['aria-label']).toBe('切换音乐平台，当前：哔哩哔哩')
    dispatchCatalogEvent(button, 'onClick')
    await nextTick()
    expect(view.root.textContent).toContain('内置音乐源')
    expect(view.root.textContent).toContain('自定义音乐源')
    expect(
      findCatalogElement(
        view.root,
        (node) => node.textContent.includes('哔哩哔哩') && node.tag === 'button',
      ).props['aria-pressed'],
    ).toBe(true)
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.textContent.includes('我的平台') && node.tag === 'button',
      ),
      'onClick',
    )
    await nextTick()
    expect(events).toEqual(['external', 'close'])
    expect(view.root.textContent).not.toContain('我的平台')
    trigger.unmount()
    view.unmount()
  })

  it('dismisses or reselects the current platform without requesting activation', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const view = mountCatalogComponent(MusicSourcePickerDialog, {
      open: true,
      activeSourceId: 'bilibili',
      builtInSources: [{ id: 'bilibili', name: '哔哩哔哩' }],
      externalSources: [],
      onSelect,
      onClose,
    })
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '关闭'),
      'onClick',
    )
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-pressed'] === true),
      'onClick',
    )
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(view.root.textContent).not.toContain('自定义音乐源')
    view.unmount()
  })
})
