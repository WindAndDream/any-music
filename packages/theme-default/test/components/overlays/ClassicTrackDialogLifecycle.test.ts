import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onMounted, onUnmounted, reactive } from 'vue'

import ClassicRoot from '../../../src/ClassicRoot.vue'
import { useClassicOverlays } from '../../../src/composables/use-classic-overlays'
import { findCatalogElement, mountCatalogComponent } from '../../helpers/test-renderer'

const lifecycle = vi.hoisted(() => ({ mounted: 0, unmounted: 0 }))

vi.mock('@any-music/ui', async (load) => {
  const ui = await load<typeof import('@any-music/ui')>()
  const vue = await import('vue')
  return {
    ...ui,
    BottomSheet: vue.defineComponent({ setup: () => () => null }),
    useElementBlockSize: () => vue.shallowRef(0),
  }
})
vi.mock('../../../src/components/shell/ClassicShell.vue', () => ({
  default: defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h('main', slots.overlays?.()),
  }),
}))
vi.mock('../../../src/components/overlays/ClassicTrackDialog.vue', () => ({
  default: defineComponent({
    props: ['open', 'trackId'],
    emits: ['afterLeave'],
    setup(props, { emit }) {
      const overlays = useClassicOverlays(() => false)
      onMounted(() => lifecycle.mounted++)
      onUnmounted(() => lifecycle.unmounted++)
      return () =>
        h('div', {
          'data-dialog': '',
          open: props.open,
          trackId: props.trackId,
          'data-opener': overlays?.trackActionId.value,
          onFinish: () => emit('afterLeave', props.trackId),
        })
    },
  }),
}))

afterEach(() => {
  lifecycle.mounted = 0
  lifecycle.unmounted = 0
})

describe('classic track action dialog lifetime', () => {
  it('retains the opener through closing, cancels stale same-track closes and clears on navigation', async () => {
    const overlays = reactive<{ active: { kind: 'track-actions'; trackId: string } | null }>({
      active: null,
    })
    const shell = reactive({ activeViewId: 'favorites' })
    const trackList = { state: { queuedTrackIds: [] }, actions: {}, availability: {} }
    const features = {
      shell: { state: shell },
      navigation: {},
      queue: trackList,
      favorites: trackList,
      downloads: { ...trackList, state: { ...trackList.state, batches: [] } },
      overlays: { state: overlays, actions: { close: () => (overlays.active = null) } },
    }
    const view = mountCatalogComponent(ClassicRoot, { features, views: {}, form: 'desktop' })
    const dialog = () => findCatalogElement(view.root, (node) => 'data-dialog' in node.props)
    try {
      overlays.active = { kind: 'track-actions', trackId: 'first' }
      await nextTick()
      overlays.active = null
      await nextTick()
      expect(dialog().props['data-opener']).toBe('first')
      const finish = dialog().props.onFinish as () => void
      finish()
      expect(dialog().props['data-opener']).toBe('first')
      overlays.active = { kind: 'track-actions', trackId: 'first' }
      overlays.active = null
      await nextTick()
      await nextTick()
      expect(dialog().props['data-opener']).toBe('first')
      ;(dialog().props.onFinish as () => void)()
      await nextTick()
      await nextTick()
      await nextTick()
      expect(dialog().props['data-opener']).toBeUndefined()
      overlays.active = { kind: 'track-actions', trackId: 'first' }
      await nextTick()
      expect(dialog().props['data-opener']).toBe('first')
      shell.activeViewId = 'queue'
      await nextTick()
      expect(dialog().props['data-opener']).toBeUndefined()
    } finally {
      view.unmount()
    }
  })

  it.each(['queue', 'favorites', 'downloads'])(
    'keeps the %s dialog mounted across opening, closing and reopening',
    async (viewId) => {
      const overlays = reactive<{ active: { kind: 'track-actions'; trackId: string } | null }>({
        active: null,
      })
      const trackList = { state: { queuedTrackIds: [] }, actions: {}, availability: {} }
      const features = {
        shell: { state: { activeViewId: viewId } },
        navigation: {},
        queue: trackList,
        favorites: trackList,
        downloads: { ...trackList, state: { ...trackList.state, batches: [] } },
        overlays: { state: overlays, actions: { close: () => (overlays.active = null) } },
      }
      const view = mountCatalogComponent(ClassicRoot, { features, views: {}, form: 'desktop' })
      const dialog = () => findCatalogElement(view.root, (node) => 'data-dialog' in node.props)
      expect(lifecycle.mounted).toBe(0)

      overlays.active = { kind: 'track-actions', trackId: 'first' }
      await nextTick()
      expect(dialog().props).toMatchObject({ open: true, trackId: 'first' })
      overlays.active = null
      await nextTick()
      expect(dialog().props).toMatchObject({ open: false, trackId: 'first' })
      overlays.active = { kind: 'track-actions', trackId: 'first' }
      await nextTick()
      expect(dialog().props).toMatchObject({ open: true, trackId: 'first' })
      expect(lifecycle.mounted).toBe(1)
      expect(lifecycle.unmounted).toBe(0)
      overlays.active = { kind: 'track-actions', trackId: 'second' }
      await nextTick()
      expect(dialog().props).toMatchObject({ open: true, trackId: 'second' })
      expect(lifecycle.mounted).toBe(2)
      expect(lifecycle.unmounted).toBe(1)
      view.unmount()
    },
  )
})
