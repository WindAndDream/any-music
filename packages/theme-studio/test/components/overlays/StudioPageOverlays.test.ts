import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import StudioPageOverlays from '../../../src/components/overlays/StudioPageOverlays.vue'
import { provideStudioOverlays } from '../../../src/composables/use-studio-overlays'
import { findStudioNode, mountStudio } from '../../helpers/test-renderer'

describe('Studio page dialogs', () => {
  it('moves dialogs outside scrolling content and releases modal state when the page leaves', async () => {
    const open = shallowRef(false)
    const mounted = shallowRef(true)
    const Host = defineComponent({
      setup() {
        const overlays = provideStudioOverlays()
        return () =>
          h('section', [
            h(
              'main',
              { inert: overlays.modalOpen.value ? true : undefined },
              mounted.value
                ? [
                    h(
                      StudioPageOverlays,
                      { open: open.value },
                      { default: () => (open.value ? h('article', '筛选器') : null) },
                    ),
                  ]
                : [],
            ),
            h('div', { ref: 'pageModalTarget', 'data-overlay-target': true }),
          ])
      },
    })
    const view = mountStudio(Host, {})
    try {
      await nextTick()
      open.value = true
      await nextTick()
      await nextTick()
      const main = findStudioNode(view.root, (node) => node.tag === 'main')
      const target = findStudioNode(view.root, (node) => Boolean(node.props['data-overlay-target']))
      expect(main.props.inert).toBe(true)
      expect(main.textContent).not.toContain('筛选器')
      expect(target.textContent).toContain('筛选器')
      mounted.value = false
      await nextTick()
      await nextTick()
      expect(main.props.inert).toBeUndefined()
      expect(target.textContent).not.toContain('筛选器')
    } finally {
      view.unmount()
    }
  })
})
