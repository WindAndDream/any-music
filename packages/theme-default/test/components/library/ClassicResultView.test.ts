import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import ClassicResultView from '../../../src/components/library/ClassicResultView.vue'
import { findCatalogElement, mountCatalogComponent } from '../../helpers/test-renderer'

it('replaces results in one patch when switching and reversing direction', async () => {
  const mode = shallowRef('first')
  const count = shallowRef(0)
  const beforeLeave = vi.fn()
  const view = mountCatalogComponent(
    defineComponent({
      setup: () => () =>
        h(
          ClassicResultView,
          {
            as: 'fieldset',
            disabled: true,
            viewKey: mode.value,
            reverse: mode.value === 'first',
            onBeforeLeave: beforeLeave,
          },
          () => `${mode.value}: ${count.value}`,
        ),
    }),
    {},
  )
  const result = () => findCatalogElement(view.root, (node) => node.tag === 'fieldset')
  try {
    const first = result()
    expect(first.props.disabled).toBe(true)
    expect(first.getAttribute('data-classic-result-enter')).toBeNull()
    mode.value = 'second'
    await nextTick()
    const second = result()
    expect(first.parent).toBeNull()
    expect(second.textContent).toBe('second: 0')
    expect(second.getAttribute('data-classic-result-enter')).toBe('forward')
    expect(beforeLeave).toHaveBeenCalledExactlyOnceWith(first)

    mode.value = 'first'
    await nextTick()
    expect(second.parent).toBeNull()
    const restored = result()
    expect(restored.textContent).toBe('first: 0')
    expect(restored.getAttribute('data-classic-result-enter')).toBe('back')
    beforeLeave.mockClear()
    count.value = 1
    await nextTick()
    expect(result()).toBe(restored)
    expect(restored.textContent).toBe('first: 1')
    expect(beforeLeave).not.toHaveBeenCalled()
  } finally {
    view.unmount()
  }
})
