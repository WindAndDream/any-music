import { describe, expect, it, vi } from 'vitest'
import { createRenderer, h, readonly } from 'vue'

import MaterialFilterBar from '../../../src/vue/components/MaterialFilterBar.vue'
import type { MaterialLibraryFilterState } from '../../../src/vue/use-material-library-filters'

vi.mock('@any-music/ui', () => ({
  useUiContributionAvailability: () => ({ allows: () => true }),
}))

// Execute the compiled native v-model assignments against a readonly host projection.
class Element {
  children: Element[] = []
  parent: Element | null = null
  props: Record<string, unknown> = {}
  value = ''
  selected = false
  readonly tag: string
  constructor(tag: string) {
    this.tag = tag
  }
  get options() {
    return this.children.filter((child) => child.tag === 'option')
  }
  addEventListener() {}
}

function flatten(node: Element): Element[] {
  return [node, ...node.children.flatMap(flatten)]
}

const renderer = createRenderer<Element, Element>({
  createElement: (tag) => new Element(tag),
  createText: () => new Element('#text'),
  createComment: () => new Element('#comment'),
  setText() {},
  setElementText() {},
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  patchProp: (node, key, _previous, value) => {
    node.props[key] = value
    if (key === 'value') node.value = String(value ?? '')
  },
  insert: (node, parent) => {
    node.parent = parent
    parent.children.push(node)
  },
  remove: (node) => {
    if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node)
    node.parent = null
  },
})

describe('MaterialFilterBar host editing boundary', () => {
  it('emits replacements for all six fields without mutating the readonly input', () => {
    const initial: MaterialLibraryFilterState = {
      query: '',
      membership: 'included',
      trackKind: 'all',
      platformId: '',
      tag: '',
      sortMode: 'updated',
    }
    const update = vi.fn()
    const root = new Element('root')
    const app = renderer.createApp({
      render: () =>
        h(MaterialFilterBar, {
          modelValue: readonly(initial),
          platforms: [{ id: 'bilibili', name: '哔哩哔哩', count: 1 }],
          tagStats: [{ name: '测试', count: 1 }],
          'onUpdate:modelValue': update,
        }),
    })
    app.mount(root)
    const fields = flatten(root).filter((node) => node.tag === 'input' || node.tag === 'select')
    const edits = [
      ['query', '测试歌曲'],
      ['membership', 'all'],
      ['trackKind', 'regular'],
      ['platformId', 'bilibili'],
      ['tag', '测试'],
      ['sortMode', 'title'],
    ] as const
    try {
      expect(fields).toHaveLength(edits.length)
      expect(fields.map((field) => field.props['aria-label'])).toEqual([
        '搜索歌曲、作者或标签',
        '素材合集成员筛选',
        '素材类型筛选',
        '素材平台筛选',
        '素材标签筛选',
        '素材排序',
      ])
      edits.forEach(([key, value], index) => {
        const assign = fields[index]!.props['onUpdate:modelValue'] as (value: string) => void
        assign(value)
        expect(update).toHaveBeenLastCalledWith({ ...initial, [key]: value })
        expect(initial[key]).not.toBe(value)
      })
      expect(update).toHaveBeenCalledTimes(edits.length)
    } finally {
      app.unmount()
    }
  })
})
