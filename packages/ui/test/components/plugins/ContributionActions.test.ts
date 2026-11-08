import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, shallowRef } from 'vue'

import ContributionActions from '../../../src/components/plugins/ContributionActions.vue'
import { UI_CONTRIBUTIONS } from '../../../src/product/ui-contributions'
import type { UiContributionItem, UiListContext } from '../../../src/product/ui-contributions'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../music-sources/catalog-test-renderer'

// Keep real dialog markup/events while omitting browser-only transition classes in Node.
vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})

beforeEach(() => {
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('ShadowRoot', CatalogTestElement)
})
afterEach(() => vi.unstubAllGlobals())

describe('batch contribution input', () => {
  it('keeps existing labels inside the dialog and applies drafted labels only after confirmation', async () => {
    const options = shallowRef(
      Array.from({ length: 7 }, (_, index) => ({
        value: `标签${index + 1}`,
        selected: index === 0,
      })),
    )
    const invoke = vi.fn((_item, _point, _context, value) => {
      options.value = options.value.map((option) => ({
        ...option,
        selected: option.selected || option.value === value,
      }))
    })
    const overlay = new CatalogTestElement('overlay')
    const item: UiContributionItem = {
      id: 'feature.tags/batch-tags',
      implementationId: 'batch-tags',
      title: '添加标签',
      inputLabel: '标签名称',
      revision: 1,
      viewRevision: 1,
      contextKey: '',
    }
    const onDialogOpenChange = vi.fn()
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          provide(UI_CONTRIBUTIONS, {
            resolve: () => [{ ...item, inputOptions: options.value }],
            accepts: () => true,
            invoke,
          })
          return () =>
            h(ContributionActions, {
              point: 'trackList.operator.actions',
              context: { selectionCount: 2 },
              overlayTarget: overlay as unknown as HTMLElement,
              onDialogOpenChange,
            })
        },
      }),
      {},
    )
    try {
      expect(view.root.textContent).not.toContain('标签1')
      expect(view.root.textContent).not.toContain('标签6')
      expect(view.root.textContent).not.toContain('查看全部')
      expect(() => findCatalogElement(view.root, (node) => node.tag === 'input')).toThrow()
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent.trim() === '添加标签',
        ),
        'onClick',
      )
      await nextTick()
      expect(onDialogOpenChange).toHaveBeenLastCalledWith(true)
      const choice = (name: string) =>
        findCatalogElement(overlay, (node) => node.props['aria-label'] === `添加标签 ${name}`)
      expect(choice('标签1').props['aria-pressed']).toBe(true)
      expect(choice('标签1').props.disabled).toBe(true)
      const confirm = () =>
        findCatalogElement(
          overlay,
          (node) => node.tag === 'button' && node.textContent === '确认添加',
        )
      expect(confirm().props.disabled).toBe(true)
      dispatchCatalogEvent(choice('标签1'), 'onClick')
      expect(invoke).not.toHaveBeenCalled()
      for (const name of ['标签6', '标签7']) {
        dispatchCatalogEvent(choice(name), 'onClick')
        // eslint-disable-next-line no-await-in-loop
        await nextTick()
        expect(choice(name).props['aria-pressed']).toBe(true)
        expect(choice(name).textContent).toContain('待添加')
        expect(findCatalogElement(overlay, (node) => node.props.role === 'dialog')).toBeDefined()
      }
      expect(invoke).not.toHaveBeenCalled()
      expect(confirm().props.disabled).toBe(false)
      const search = findCatalogElement(overlay, (node) => node.props.name === 'tag-search')
      ;(search.props['onUpdate:modelValue'] as (value: string) => void)('标签7')
      await nextTick()
      expect(() => choice('标签6')).toThrow()
      expect(choice('标签7').props['aria-pressed']).toBe(true)
      // A new-label draft matching a choice must not submit the same label twice.
      const input = findCatalogElement(overlay, (node) => node.props.name === 'contribution-input')
      ;(input.props['onUpdate:modelValue'] as (value: string) => void)(' 标签7 ')
      await nextTick()
      dispatchCatalogEvent(confirm(), 'onClick')
      expect(invoke.mock.calls.map((call) => call[3])).toEqual(['标签6', '标签7'])
      await nextTick()
      expect(onDialogOpenChange).toHaveBeenLastCalledWith(false)
      expect(() => findCatalogElement(overlay, (node) => node.props.role === 'dialog')).toThrow()
    } finally {
      view.unmount()
    }
  })
  it('discards cancelled drafts, allows deselection and rejects labels already applied to all songs', async () => {
    const invoke = vi.fn()
    const item: UiContributionItem = {
      id: 'feature.tags/batch-tags',
      implementationId: 'batch-tags',
      title: '添加标签',
      inputLabel: '标签名称',
      revision: 1,
      viewRevision: 1,
      contextKey: '',
      inputOptions: [
        { value: 'Focus', selected: true },
        { value: '通勤', selected: false },
      ],
    }
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          provide(UI_CONTRIBUTIONS, { resolve: () => [item], accepts: () => true, invoke })
          return () =>
            h(ContributionActions, {
              point: 'trackList.operator.actions',
              context: { selectionCount: 2 },
            })
        },
      }),
      {},
    )
    const button = (text: string) =>
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent.trim() === text,
      )
    const input = () =>
      findCatalogElement(view.root, (node) => node.props.name === 'contribution-input')
    const choice = () =>
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '添加标签 通勤')
    try {
      dispatchCatalogEvent(button('添加标签'), 'onClick')
      await nextTick()
      ;(input().props['onUpdate:modelValue'] as (value: string) => void)(' ＦＯＣＵＳ ')
      await nextTick()
      expect(button('确认添加').props.disabled).toBe(true)
      dispatchCatalogEvent(button('确认添加'), 'onClick')
      expect(invoke).not.toHaveBeenCalled()
      ;(input().props['onUpdate:modelValue'] as (value: string) => void)('')
      dispatchCatalogEvent(choice(), 'onClick')
      await nextTick()
      expect(button('确认添加').props.disabled).toBe(false)
      dispatchCatalogEvent(choice(), 'onClick')
      await nextTick()
      expect(button('确认添加').props.disabled).toBe(true)
      dispatchCatalogEvent(choice(), 'onClick')
      ;(input().props['onUpdate:modelValue'] as (value: string) => void)('新标签')
      await nextTick()
      dispatchCatalogEvent(button('取消'), 'onClick')
      await nextTick()
      expect(invoke).not.toHaveBeenCalled()
      dispatchCatalogEvent(button('添加标签'), 'onClick')
      await nextTick()
      expect(input().value).toBe('')
      expect(choice().props['aria-pressed']).toBe(false)
      expect(button('确认添加').props.disabled).toBe(true)
    } finally {
      view.unmount()
    }
  })
  it('closes a stale picker when the selected context changes and rejects its old handlers', async () => {
    const context = shallowRef<Partial<UiListContext>>({ area: 'catalog', selectionCount: 2 })
    const invoke = vi.fn()
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          provide(UI_CONTRIBUTIONS, {
            resolve: () => [
              {
                id: 'tags',
                implementationId: 'batch-tags',
                title: '添加标签',
                inputLabel: '标签名称',
                revision: 1,
                viewRevision: 1,
                contextKey: JSON.stringify(context.value),
                inputOptions: [{ value: '通勤', selected: false }],
              },
            ],
            accepts: (item, _point, current) => item.contextKey === JSON.stringify(current),
            invoke,
          })
          return () =>
            h(ContributionActions, { point: 'trackList.operator.actions', context: context.value })
        },
      }),
      {},
    )
    try {
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent.trim() === '添加标签',
        ),
        'onClick',
      )
      await nextTick()
      const dialog = findCatalogElement(view.root, (node) => node.props.role === 'dialog')
      const oldChoice = findCatalogElement(
        dialog,
        (node) => node.props['aria-label'] === '添加标签 通勤',
      )
      dispatchCatalogEvent(oldChoice, 'onClick')
      await nextTick()
      const oldForm = findCatalogElement(dialog, (node) => node.tag === 'form')
      context.value = { area: 'queue', selectionCount: 2 }
      await nextTick()
      dispatchCatalogEvent(oldChoice, 'onClick')
      dispatchCatalogEvent(oldForm, 'onSubmit')
      expect(invoke).not.toHaveBeenCalled()
      expect(() => findCatalogElement(view.root, (node) => node.props.role === 'dialog')).toThrow()
    } finally {
      view.unmount()
    }
  })
  it('submits the selected context and rejects an editor whose contribution was withdrawn', async () => {
    const enabled = shallowRef(true)
    const invoke = vi.fn()
    const item = {
      id: 'feature.tags/batch-tags',
      implementationId: 'batch-tags',
      title: '添加标签',
      inputLabel: '标签名称',
      revision: 1,
      viewRevision: 1,
      contextKey: '',
    }
    const context = { selectionCount: 2 }
    const host = defineComponent({
      setup() {
        provide(UI_CONTRIBUTIONS, {
          resolve: () => (enabled.value ? [item] : []),
          accepts: () => enabled.value,
          invoke,
        })
        return () => h(ContributionActions, { point: 'trackList.operator.actions', context })
      },
    })
    const view = mountCatalogComponent(host, {})
    expect(() => findCatalogElement(view.root, (node) => node.tag === 'input')).toThrow()
    const open = () =>
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent === '添加标签',
        ),
        'onClick',
      )
    open()
    await nextTick()
    const dialog = findCatalogElement(view.root, (node) => node.props.role === 'dialog')
    const input = findCatalogElement(dialog, (node) => node.tag === 'input')
    ;(input.props['onUpdate:modelValue'] as (value: string) => void)('通勤')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
    )
    expect(invoke).toHaveBeenCalledWith(item, 'trackList.operator.actions', context, '通勤')
    await nextTick()
    open()
    await nextTick()
    const oldForm = findCatalogElement(view.root, (node) => node.tag === 'form')
    enabled.value = false
    dispatchCatalogEvent(oldForm, 'onSubmit')
    expect(invoke).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
