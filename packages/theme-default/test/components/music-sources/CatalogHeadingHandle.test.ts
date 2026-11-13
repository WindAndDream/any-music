import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import CatalogHeadingHandle from '../../../src/components/music-sources/CatalogHeadingHandle.vue'
import { findCatalogElement, mountCatalogComponent } from '../../helpers/test-renderer'

describe('CatalogHeadingHandle', () => {
  it('keeps an accessible native control with names and expanded state matching the controlled context', async () => {
    const props = reactive({
      collapsed: false,
      controls: 'catalog-context',
      onUpdateCollapsed: (value: boolean) => {
        props.collapsed = value
      },
    })
    const view = mountCatalogComponent(CatalogHeadingHandle, props)
    const button = findCatalogElement(view.root, (node) => node.tag === 'button')
    const click = button.props.onClick as (event: MouseEvent) => void
    expect(button.props.type).toBe('button')
    expect(button.props['aria-controls']).toBe('catalog-context')
    expect(button.props['aria-expanded']).toBe(true)
    expect(button.props['aria-label']).toBe('收起列表信息')
    expect(button.textContent).toBe('')
    click({ detail: 0 } as MouseEvent)
    await nextTick()
    expect(button.props['aria-expanded']).toBe(false)
    expect(button.props['aria-label']).toBe('展开列表信息')
    const keydown = button.props.onKeydown as (event: KeyboardEvent) => void
    keydown({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} } as KeyboardEvent)
    await nextTick()
    expect(button.props['aria-expanded']).toBe(true)
    view.unmount()
  })

  it('disables clicking and removes click guidance in mobile drag-only mode', async () => {
    const updateCollapsed = vi.fn()
    const props = reactive({
      collapsed: false,
      controls: 'catalog-context',
      dragOnly: true,
      onUpdateCollapsed: updateCollapsed,
    })
    const view = mountCatalogComponent(CatalogHeadingHandle, props)
    const button = findCatalogElement(view.root, (node) => node.tag === 'button')
    const click = button.props.onClick as (event: MouseEvent) => void
    expect(button.props.title).toBe('向上拖动收起列表信息')
    click({ detail: 1, preventDefault() {} } as MouseEvent)
    click({ detail: 0, preventDefault() {} } as MouseEvent)
    expect(updateCollapsed).not.toHaveBeenCalled()
    props.collapsed = true
    await nextTick()
    expect(button.props.title).toBe('向下拖动展开列表信息')
    props.dragOnly = false
    await nextTick()
    click({ detail: 1, preventDefault() {} } as MouseEvent)
    expect(updateCollapsed).toHaveBeenCalledExactlyOnceWith(false)
    view.unmount()
  })
})
