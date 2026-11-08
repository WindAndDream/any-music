import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import CatalogContextDetailsDialog from '../../../src/components/music-sources/CatalogContextDetailsDialog.vue'
import { mountCatalogComponent } from '../../helpers/test-renderer'

vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? h('section', slots.default?.()) : null,
    }),
  }
})

describe('CatalogContextDetailsDialog', () => {
  it.each(['search', 'import-url'] as const)(
    'shows the complete original %s input even after renaming and drops stale content on close',
    async (kind) => {
      const input =
        kind === 'search'
          ? '原始搜索词 <现场>\n'.repeat(40)
          : `https://example.com/${'a'.repeat(300)}`
      const props = reactive({ open: false, drawer: { kind, title: '重命名后的列表', input } })
      const view = mountCatalogComponent(CatalogContextDetailsDialog, props)
      expect(view.root.textContent).not.toContain(input)
      props.open = true
      await nextTick()
      expect(view.root.textContent).toContain('重命名后的列表')
      expect(view.root.textContent).toContain(kind === 'search' ? '原始搜索词' : '导入链接')
      expect(view.root.textContent).toContain(input)
      props.open = false
      await nextTick()
      expect(view.root.textContent).not.toContain(input)
      view.unmount()
    },
  )
})
