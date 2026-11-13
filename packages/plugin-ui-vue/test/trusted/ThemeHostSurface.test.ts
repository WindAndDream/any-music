import { expect, it } from 'vitest'
import { defineComponent, h, nextTick, Teleport } from 'vue'

import ThemeHostSurface from '../../src/trusted/ThemeHostSurface.vue'
import {
  CatalogTestElement,
  mountCatalogComponent,
  findCatalogElement,
} from '../helpers/test-renderer'

it('keeps native detail overlay targets inside the independently styled protected surface', async () => {
  const shadows: CatalogTestElement[] = []
  Object.assign(CatalogTestElement.prototype, {
    attachShadow() {
      const root = new CatalogTestElement('shadow-root')
      shadows.push(root)
      return root
    },
  })
  let overlay: HTMLElement | null = null
  const Parent = defineComponent({
    setup: () => () =>
      h(
        ThemeHostSurface,
        { css: 'host-only-css', theme: 'dark' },
        {
          default: (context: { overlayTarget: HTMLElement | null }) => {
            overlay = context.overlayTarget
            return h('input', { 'aria-label': 'native identity' })
          },
        },
      ),
  })
  const mounted = mountCatalogComponent(Parent, {})
  try {
    await nextTick()
    await nextTick()
    const target = overlay as HTMLElement | null
    expect(target).not.toBeNull()
    expect(target?.getRootNode()).toBe(shadows[0])
    expect(findCatalogElement(shadows[0]!, (node) => node.tag === 'style').textContent).toBe(
      'host-only-css',
    )
    expect(
      findCatalogElement(shadows[0]!, (node) => node.props.class === 'am-root').props[
        'data-am-theme'
      ],
    ).toBe('dark')
  } finally {
    mounted.unmount()
    delete (CatalogTestElement.prototype as unknown as { attachShadow?: unknown }).attachShadow
  }
})

it('renders protected detail dialogs outside a suspended theme ancestor with host-only CSS', async () => {
  const shadows: CatalogTestElement[] = []
  Object.assign(CatalogTestElement.prototype, {
    attachShadow() {
      const root = new CatalogTestElement('shadow-root')
      shadows.push(root)
      return root
    },
  })
  const external = new CatalogTestElement('host-overlay-root')
  let overlay: HTMLElement | null = null
  const Parent = defineComponent({
    setup: () => () =>
      h('section', { inert: true }, [
        h(
          ThemeHostSurface,
          { css: 'protected-css', theme: 'dark', overlayRoot: external as unknown as HTMLElement },
          {
            default: (context: { overlayTarget: HTMLElement | null }) => {
              overlay = context.overlayTarget
              return [
                h('input', { 'aria-label': 'native account' }),
                context.overlayTarget
                  ? h(Teleport, { to: context.overlayTarget }, h('button', 'Native detail'))
                  : null,
              ]
            },
          },
        ),
      ]),
  })
  const mounted = mountCatalogComponent(Parent, {})
  try {
    await nextTick()
    await nextTick()
    await nextTick()
    expect(shadows).toHaveLength(2)
    expect((overlay as HTMLElement | null)?.getRootNode()).toBe(shadows[1])
    expect(shadows[1]!.textContent).toContain('Native detail')
    expect(findCatalogElement(shadows[1]!, (node) => node.tag === 'style').textContent).toBe(
      'protected-css',
    )
    expect(
      findCatalogElement(external, (node) => node.props['data-am-host-surface'] === 'slot-overlays')
        .parent,
    ).toBe(external)
    expect(
      findCatalogElement(shadows[1]!, (node) => node.props.class === 'am-root').props[
        'data-am-theme'
      ],
    ).toBe('dark')
  } finally {
    mounted.unmount()
    expect(external.children).toHaveLength(0)
    delete (CatalogTestElement.prototype as unknown as { attachShadow?: unknown }).attachShadow
  }
})
