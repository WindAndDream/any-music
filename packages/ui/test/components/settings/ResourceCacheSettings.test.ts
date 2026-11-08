import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import ResourceCacheHelpButton from '../../../src/components/settings/ResourceCacheHelpButton.vue'
import ResourceCacheSettings from '../../../src/components/settings/ResourceCacheSettings.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../music-sources/catalog-test-renderer'

vi.mock('../../../src/components/AppDialog.vue', () => ({
  default: defineComponent({
    props: ['open'],
    emits: ['close'],
    setup:
      (props, { slots, emit }) =>
      () =>
        props.open
          ? h('section', [
              slots.default?.(),
              h('button', { onClick: () => emit('close') }, '关闭介绍'),
            ])
          : null,
  }),
}))
afterEach(() => vi.unstubAllGlobals())

describe('resource cache settings', () => {
  it('keeps disk, memory, refresh and clear actions independent', () => {
    const save = vi.fn()
    const saveMemory = vi.fn()
    const refresh = vi.fn()
    const clear = vi.fn()
    const update = vi.fn()
    const view = mountCatalogComponent(ResourceCacheSettings, {
      snapshot: {
        capacityBytes: 1024 ** 3,
        usedBytes: 0,
        imageBytes: 0,
        audioBytes: 0,
        entryCount: 0,
        memoryCapacityBytes: 64 * 1024 ** 2,
        memoryUsedBytes: 0,
        memoryEntryCount: 0,
        directory: '/cache',
        customDirectory: false,
        canChooseDirectory: false,
        description: '运行端缓存说明',
      },
      capacityMib: '1024',
      memoryCapacityMib: '64',
      busy: false,
      onSave: save,
      onSaveMemory: saveMemory,
      onRefresh: refresh,
      onClear: clear,
      'onUpdate:memoryCapacityMib': update,
    })
    expect(view.root.textContent).toContain('内存缓存')
    expect(view.root.textContent).not.toContain('运行端缓存说明')
    const memory = findCatalogElement(
      view.root,
      (node) => node.props['data-am-focus-key'] === 'settings:cache:memory-capacity',
    )
    memory.value = '0'
    dispatchCatalogEvent(memory, 'onInput', false)
    expect(update).toHaveBeenCalledWith('0')
    const memorySave = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.props['aria-label'] === '保存内存缓存上限',
    )
    expect(memorySave.textContent.trim()).toBe('保存上限')
    dispatchCatalogEvent(memorySave.closest('form')!, 'onSubmit', false)
    expect(saveMemory).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
    const diskSave = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.props['aria-label'] === '保存硬盘缓存上限',
    )
    expect(diskSave.textContent.trim()).toBe('保存上限')
    const clearButton = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.textContent.trim() === '清除缓存…',
    )
    expect(clearButton.props.type).toBe('button')
    dispatchCatalogEvent(clearButton, 'onClick', false)
    expect(clear).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
    dispatchCatalogEvent(diskSave.closest('form')!, 'onSubmit', false)
    expect(save).toHaveBeenCalledOnce()
    expect(saveMemory).toHaveBeenCalledOnce()
    const refreshButton = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.props['aria-label'] === '刷新用量',
    )
    expect(refreshButton.textContent.trim()).toBe('')
    dispatchCatalogEvent(refreshButton, 'onClick', false)
    expect(refresh).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('opens supporting text from the header help button on demand', async () => {
    vi.stubGlobal('document', { activeElement: null })
    const detail = vi.fn()
    const overlay = new CatalogTestElement('overlay')
    const view = mountCatalogComponent(ResourceCacheHelpButton, {
      overlayTarget: overlay as unknown as HTMLElement,
      description: '运行端缓存说明',
      onDetailOpenChange: detail,
    })
    expect(overlay.textContent).not.toContain('运行端缓存说明')
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent.includes('缓存介绍'),
      ),
      'onClick',
      false,
    )
    await nextTick()
    expect(detail).toHaveBeenLastCalledWith(true)
    expect(overlay.textContent).toContain('运行端缓存说明')
    dispatchCatalogEvent(
      findCatalogElement(
        overlay,
        (node) => node.tag === 'button' && node.textContent === '关闭介绍',
      ),
      'onClick',
      false,
    )
    await nextTick()
    expect(detail).toHaveBeenLastCalledWith(false)
    expect(overlay.textContent).not.toContain('运行端缓存说明')
    view.unmount()
  })
})
