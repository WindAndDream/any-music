import type { OrdinaryOverlaysProps } from '@any-music/ui/theme'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'

import OrdinaryOverlays from '../../../src/components/overlays/OrdinaryOverlays.vue'
import { findCatalogElement, mountCatalogComponent } from '../../helpers/test-renderer'

vi.mock('@any-music/ui/components/product-workbench/ConfirmationDialog.vue', () => ({
  default: defineComponent({
    props: ['request'],
    emits: ['confirm', 'cancel'],
    setup:
      (props, { emit }) =>
      () =>
        props.request
          ? h('section', [
              h('button', { onClick: () => emit('confirm') }, props.request.confirmLabel),
              h('button', { onClick: () => emit('cancel') }, props.request.cancelLabel),
            ])
          : null,
  }),
}))

describe('ordinary overlay request identity', () => {
  it('rejects retained confirm/cancel events after replacement, close and disposal', async () => {
    const request = {
      id: 1,
      title: 'Remove',
      message: 'Review',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      tone: 'danger' as const,
    }
    const props = reactive<OrdinaryOverlaysProps>({ request })
    const confirm = vi.fn()
    const cancel = vi.fn()
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () => h(OrdinaryOverlays, { ...props, onConfirm: confirm, onCancel: cancel }),
      }),
      {},
    )
    const confirmButton = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.textContent === 'Confirm',
    )
    // Capture the bound listener, rather than a live VNode which Vue updates in place.
    const oldConfirm = confirmButton.props.onClick as () => void
    props.request = { ...request, id: 2 }
    await nextTick()
    oldConfirm()
    expect(confirm).not.toHaveBeenCalled()
    const currentConfirm = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.textContent === 'Confirm',
    ).props.onClick as () => void
    const currentCancel = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.textContent === 'Cancel',
    ).props.onClick as () => void
    currentConfirm()
    expect(confirm).toHaveBeenCalledExactlyOnceWith(2)
    currentCancel()
    expect(cancel).toHaveBeenCalledExactlyOnceWith(2)
    props.request = undefined
    await nextTick()
    oldConfirm()
    currentConfirm()
    currentCancel()
    expect(confirm).toHaveBeenCalledTimes(1)
    view.unmount()
    oldConfirm()
    currentConfirm()
    currentCancel()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
