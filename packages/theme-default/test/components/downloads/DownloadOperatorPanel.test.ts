import { describe, expect, it, vi } from 'vitest'

import DownloadOperatorPanel from '../../../src/components/downloads/DownloadOperatorPanel.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

describe('download operator cancellation', () => {
  it.each([false, true])('exposes selected-task cancellation when available=%s', (canCancel) => {
    const onCancel = vi.fn()
    const view = mountCatalogComponent(DownloadOperatorPanel, {
      selectedCount: 2,
      visibleCount: 2,
      allSelected: true,
      someSelected: false,
      actionLabel: '下载',
      canResume: true,
      canPause: true,
      canRemove: false,
      canCancel,
      onCancel,
    })
    try {
      const button = findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent === '取消下载',
      )
      expect(Boolean(button.props.disabled)).toBe(!canCancel)
      if (canCancel) {
        dispatchCatalogEvent(button, 'onClick', false)
        expect(onCancel).toHaveBeenCalledOnce()
      }
    } finally {
      view.unmount()
    }
  })
})
