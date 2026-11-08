import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import CatalogContextTitle from '../../../src/components/music-sources/CatalogContextTitle.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

afterEach(() => vi.unstubAllGlobals())

describe('CatalogContextTitle', () => {
  it('uses full text, then platform with the original input, and makes only the remaining truncation clickable', async () => {
    const observers: { notify: () => void; disconnect: ReturnType<typeof vi.fn> }[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        disconnect = vi.fn()
        constructor(notify: () => void) {
          observers.push({ notify, disconnect: this.disconnect })
        }
      },
    )
    const onShowDetails = vi.fn()
    const props = reactive({
      title: '哔哩哔哩 · 搜索：现场音乐',
      input: '现场音乐',
      pluginName: '哔哩哔哩',
      expanded: false,
      onShowDetails,
    })
    const view = mountCatalogComponent(CatalogContextTitle, props)
    await nextTick()
    const available = findCatalogElement(
      view.root,
      (node) => node.props.class === 'catalog-context-title__measurements',
    )
    const title = findCatalogElement(available, (node) => node.textContent === props.title)
    const compactText = `${props.pluginName} · ${props.input}`
    const compactTitle = findCatalogElement(available, (node) => node.textContent === compactText)
    Object.assign(title, { scrollWidth: 260 })
    Object.assign(compactTitle, { scrollWidth: 200 })
    const resize = async (width: number) => {
      Object.assign(available, { clientWidth: width })
      observers.at(-1)!.notify()
      await nextTick()
    }
    const visibleText = () =>
      findCatalogElement(view.root, (node) => node.props.class === 'catalog-context-title__text')
    const button = () => findCatalogElement(view.root, (node) => node.tag === 'button')
    await resize(300)
    expect(visibleText().textContent).toBe(props.title)
    expect(button).toThrow()
    await resize(230)
    expect(visibleText().textContent).toBe(compactText)
    expect(button).toThrow()
    await resize(80)
    expect(visibleText().textContent).toBe(compactText)
    expect(button().props['aria-haspopup']).toBe('dialog')
    dispatchCatalogEvent(button(), 'onClick')
    expect(onShowDetails).toHaveBeenCalledOnce()
    // 字体加载改变自然宽度时也重测，最终状态不取决于先前是否展示按钮。
    Object.assign(compactTitle, { scrollWidth: 70 })
    await resize(80)
    expect(button).toThrow()
    await resize(300)
    expect(visibleText().textContent).toBe(props.title)
    props.title = '新名称'
    Object.assign(title, { scrollWidth: 60 })
    await nextTick()
    expect(visibleText().textContent).toBe('新名称')
    view.unmount()
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true)
  })
})
