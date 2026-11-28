import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import type { Component } from 'vue'

import VirtualGridCell from '../../../src/components/virtual-scroll/VirtualGridCell.vue'
import { mountCatalogComponent } from '../music-sources/catalog-test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    // Production Vue exposes the shallow template ref directly.
    useTemplateRef: <T>(key: string) => vue.toRaw(vue.useTemplateRef<T>(key)),
  }
})

it('keeps production cell registrations across row snapshots and renews interaction on handoff', async () => {
  const row = shallowRef({
    key: 'track',
    item: 'Original name',
    index: 0,
    rowIndex: 0,
    columnIndex: 0,
    start: 0,
    end: 32,
    size: 32,
    inlineStart: 0,
    inlineSize: 320,
  })
  const interactionGeneration = shallowRef(0)
  const releaseInteraction = vi.fn()
  const observe = vi.fn(() => () => {})
  const registerMotion = vi.fn(() => () => {})
  const registerInteraction = vi.fn(() => releaseInteraction)
  const view = mountCatalogComponent(
    defineComponent(
      () => () =>
        h(VirtualGridCell as unknown as Component, {
          row: row.value,
          count: 1,
          gridRow: 1,
          interactionGeneration: interactionGeneration.value,
          observe,
          registerMotion,
          registerInteraction,
        }),
    ),
    {},
  )

  try {
    await nextTick()
    row.value = { ...row.value, item: 'Updated name' }
    await nextTick()
    expect(registerInteraction).toHaveBeenCalledTimes(1)
    expect(releaseInteraction).not.toHaveBeenCalled()
    expect(observe).toHaveBeenCalledTimes(1)
    expect(registerMotion).toHaveBeenCalledTimes(1)

    interactionGeneration.value++
    await nextTick()
    expect(registerInteraction).toHaveBeenCalledTimes(2)
    expect(releaseInteraction).toHaveBeenCalledTimes(1)
  } finally {
    view.unmount()
  }
})
