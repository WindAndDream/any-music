import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useFilterDraft } from '../../../src/composables/filters/use-filter-draft'

describe('shared filter draft transaction', () => {
  it('isolates nested preview edits, cancels on close and commits only the explicit draft', async () => {
    const scope = effectScope()
    const applied = shallowRef({ ranges: [{ from: 1, to: 2 }] })
    const open = shallowRef(false)
    const apply = vi.fn((state) => {
      applied.value = state
    })
    const editor = scope.run(() =>
      useFilterDraft({
        applied,
        open,
        apply,
        clone: (state) => ({ ranges: state.ranges.map((range) => ({ ...range })) }),
      }),
    )!
    open.value = true
    await nextTick()
    editor.preview.value.ranges[0]!.from = 3
    editor.draft.value.ranges[0]!.to = 4
    expect(applied.value).toEqual({ ranges: [{ from: 1, to: 2 }] })
    expect(editor.draft.value.ranges[0]!.from).toBe(1)
    expect(apply).not.toHaveBeenCalled()
    open.value = false
    await nextTick()
    expect(editor.draft.value).toEqual(applied.value)
    open.value = true
    await nextTick()
    editor.draft.value = { ranges: [{ from: 5, to: 6 }] }
    editor.preview.value = { ranges: [{ from: 7, to: 8 }] }
    editor.applyDraft()
    expect(applied.value).toEqual({ ranges: [{ from: 5, to: 6 }] })
    editor.draft.value.ranges[0]!.from = 99
    expect(applied.value.ranges[0]!.from).toBe(5)
    scope.stop()
  })

  it('keeps separate filter editors independent and uses the latest applied snapshot on reopening', async () => {
    const scope = effectScope()
    const first = shallowRef('first')
    const second = shallowRef('second')
    const open = shallowRef(false)
    const editors = scope.run(() =>
      [first, second].map((applied) =>
        useFilterDraft({
          applied,
          open,
          clone: (value) => value,
          apply: (value) => {
            applied.value = value
          },
        }),
      ),
    )!
    open.value = true
    await nextTick()
    editors[0]!.draft.value = 'changed'
    editors[0]!.applyDraft()
    expect(second.value).toBe('second')
    expect(editors[1]!.draft.value).toBe('second')
    open.value = false
    await nextTick()
    first.value = 'external update'
    open.value = true
    await nextTick()
    expect(editors[0]!.draft.value).toBe('external update')
    scope.stop()
  })
})
