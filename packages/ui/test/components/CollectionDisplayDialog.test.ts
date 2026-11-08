import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import CollectionDisplayDialog from '../../src/components/CollectionDisplayDialog.vue'
import DisplayOptionsDialog from '../../src/components/DisplayOptionsDialog.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from './music-sources/catalog-test-renderer'
import type { CatalogTestElement } from './music-sources/catalog-test-renderer'

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
vi.mock('../../src/components/AppDialog.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open
            ? vue.h('section', [
                slots.default?.(),
                ...(slots.footer ? [vue.h('footer', slots.footer())] : []),
              ])
            : null,
    }),
  }
})

const styles = [
  { id: 'default' as const, label: '直显', description: '常用操作直接显示在卡片中' },
  { id: 'minimal' as const, label: '留白', description: '简约卡牌' },
]
describe('collection display navigation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('selects whitespace when no item style has been chosen', async () => {
    const view = mountCatalogComponent(CollectionDisplayDialog, {
      open: true,
      displayMode: 'standard',
      mobileColumns: 1,
      styles,
    })
    try {
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['data-display-section'] === 'style'),
        'onClick',
        false,
      )
      await nextTick()
      expect(
        findCatalogElement(view.root, (node) => node.props['data-mode'] === 'minimal').props[
          'aria-pressed'
        ],
      ).toBe(true)
    } finally {
      view.unmount()
    }
  })

  it.each(['style', 'arrangement'])(
    'returns from %s using the footer without changing preferences',
    async (id) => {
      const close = vi.fn()
      const update = vi.fn()
      const view = mountCatalogComponent(CollectionDisplayDialog, {
        open: true,
        displayMode: 'compact',
        mobileColumns: 2,
        styles,
        onClose: close,
        onUpdateItemStyle: update,
        onUpdateDisplayMode: update,
        onUpdateMobileColumns: update,
      })
      try {
        dispatchCatalogEvent(
          findCatalogElement(view.root, (node) => node.props['data-display-section'] === id),
          'onClick',
          false,
        )
        await nextTick()
        const footer = findCatalogElement(view.root, (node) => node.tag === 'footer')
        const back = findCatalogElement(
          footer,
          (node) => node.tag === 'button' && node.textContent === '返回',
        )
        const selected = findCatalogElement(
          view.root,
          (node) => node.props['aria-pressed'] === true,
        )
        expect(selected.textContent).toContain('已选')
        dispatchCatalogEvent(back, 'onClick', false)
        await nextTick()
        expect(view.root.textContent).toContain('风格选择')
        expect(view.root.textContent).toContain('排列方式')
        expect(() => findCatalogElement(view.root, (node) => node.tag === 'footer')).toThrow()
        expect(close).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
      } finally {
        view.unmount()
      }
    },
  )

  it.each([false, true])(
    'resizes during navigation and cleans up interrupted motion (reduced motion: %s)',
    async (reducedMotion) => {
      const cancel = vi.fn()
      const animate = vi.fn(() => ({ cancel }))
      const dialog = { animate }
      let measuredSize = '320px'
      vi.stubGlobal('window', { matchMedia: () => ({ matches: reducedMotion }) })
      vi.stubGlobal('getComputedStyle', () => ({
        blockSize: measuredSize,
        getPropertyValue: (name: string) =>
          name === '--am-motion-normal' ? '220ms' : 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      }))
      const view = mountCatalogComponent(CollectionDisplayDialog, {
        open: true,
        displayMode: 'standard',
        mobileColumns: 1,
        styles,
      })
      const attachDialog = () => {
        const page = findCatalogElement(view.root, (node) => node.props.tabindex === '-1')
        page.closest = () => dialog as unknown as CatalogTestElement
      }
      try {
        attachDialog()
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.props['data-display-section'] === 'arrangement',
          ),
          'onClick',
          false,
        )
        measuredSize = '480px'
        await nextTick()
        if (reducedMotion) expect(animate).not.toHaveBeenCalled()
        else
          expect(animate).toHaveBeenLastCalledWith(
            [{ blockSize: '320px' }, { blockSize: '480px' }],
            { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
          )
        attachDialog()
        // Return before the previous animation finishes; start at its current visible height.
        measuredSize = '400px'
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.tag === 'button' && node.textContent === '返回',
          ),
          'onClick',
          false,
        )
        measuredSize = '320px'
        await nextTick()
        if (reducedMotion) expect(animate).not.toHaveBeenCalled()
        else {
          expect(cancel).toHaveBeenCalledOnce()
          expect(animate).toHaveBeenLastCalledWith(
            [{ blockSize: '400px' }, { blockSize: '320px' }],
            { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
          )
        }
      } finally {
        view.unmount()
      }
      expect(cancel).toHaveBeenCalledTimes(reducedMotion ? 0 : 2)
    },
  )

  it('navigates separate categories, emits only the chosen setting and resets on reopen', async () => {
    const open = shallowRef(true),
      style = vi.fn(),
      density = vi.fn(),
      columns = vi.fn(),
      close = vi.fn()
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () =>
          h(CollectionDisplayDialog, {
            open: open.value,
            displayMode: 'compact',
            mobileColumns: 2,
            styles,
            onUpdateItemStyle: style,
            onUpdateDisplayMode: density,
            onUpdateMobileColumns: columns,
            onClose: close,
          }),
      }),
      {},
    )
    const section = (id: string) =>
      findCatalogElement(view.root, (node) => node.props['data-display-section'] === id)
    const option = (id: string) =>
      findCatalogElement(view.root, (node) => node.props['data-mode'] === id)
    try {
      dispatchCatalogEvent(section('style'), 'onClick', false)
      await nextTick()
      expect(() => section('arrangement')).toThrow()
      dispatchCatalogEvent(option('minimal'), 'onClick', false)
      expect(style).toHaveBeenCalledExactlyOnceWith('minimal')
      expect(density).not.toHaveBeenCalled()
      expect(columns).not.toHaveBeenCalled()
      expect(close).toHaveBeenCalledOnce()
      open.value = false
      await nextTick()
      open.value = true
      await nextTick()
      dispatchCatalogEvent(section('arrangement'), 'onClick', false)
      await nextTick()
      expect(option('density:compact').props['aria-pressed']).toBe(true)
      expect(option('columns:2').props['aria-pressed']).toBe(true)
      dispatchCatalogEvent(option('density:comfortable'), 'onClick', false)
      expect(density).toHaveBeenCalledExactlyOnceWith('comfortable')
      expect(columns).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })
  it('offers only style selection for search items', () => {
    const view = mountCatalogComponent(CollectionDisplayDialog, {
      open: true,
      displayMode: 'standard',
      mobileColumns: 1,
      styles,
      hideArrangement: true,
    })
    try {
      expect(view.root.textContent).toContain('风格选择')
      expect(view.root.textContent).not.toContain('排列方式')
    } finally {
      view.unmount()
    }
  })
  it('accepts another category without changing the dialog structure', async () => {
    const select = vi.fn()
    const view = mountCatalogComponent(DisplayOptionsDialog, {
      open: true,
      title: '展示方式',
      sections: [
        {
          id: 'details',
          label: '信息显示',
          description: '选择信息密度',
          value: 'full',
          options: [{ id: 'full', label: '完整' }],
        },
      ],
      onSelect: select,
    })
    try {
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['data-display-section'] === 'details'),
        'onClick',
        false,
      )
      await nextTick()
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['data-mode'] === 'full'),
        'onClick',
        false,
      )
      expect(select).toHaveBeenCalledExactlyOnceWith('details', 'full')
    } finally {
      view.unmount()
    }
  })
})
