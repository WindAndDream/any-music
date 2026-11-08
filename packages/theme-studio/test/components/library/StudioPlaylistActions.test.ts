import {
  createEditingSession,
  provideEditingSession,
  provideConfirmationDialog,
  usePlaylistEditorDraft,
} from '@any-music/ui/library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowReactive } from 'vue'

import StudioPlaylistActions from '../../../src/components/library/StudioPlaylistActions.vue'
import {
  StudioTestNode,
  findStudioNode,
  invokeStudio,
  mountStudio,
} from '../../helpers/test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})
vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title'],
      emits: ['afterLeave'],
      setup:
        (props, { slots, emit }) =>
        () =>
          vue.h(
            'section',
            {
              'data-dialog-open': props.open,
              onFinish: () => emit('afterLeave'),
            },
            slots.default?.(),
          ),
    }),
  }
})
vi.mock('@any-music/ui/components/ImagePreviewDialog.vue', () => ({
  default: defineComponent({ setup: () => () => null }),
}))

afterEach(() => vi.unstubAllGlobals())

describe('Studio playlist actions', () => {
  it('edits playlist labels, preserves input after a failed write and waits for the closing transition', async () => {
    vi.stubGlobal('Document', StudioTestNode)
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const playlist = { id: 'p', name: 'Mix', trackIds: [], createdAtMs: 1, updatedAtMs: 1 }
    const state = shallowReactive({
      nameDraft: 'Mix',
      transferBusy: false,
      coverUrls: {},
      playlists: [playlist],
      playlistTagsAvailable: true,
      customTagsByPlaylistId: new Map([['p', ['通勤']]]),
    })
    const actions = {
      addPlaylistTag: vi.fn(),
      removePlaylistTag: vi.fn(),
      favoritePlaylist: vi.fn(),
      downloadPlaylist: vi.fn(),
      exportFile: vi.fn(async () => {}),
      saveDetails: vi.fn(),
      setNameDraft: vi.fn(),
    }
    const close = vi.fn()
    const editing = createEditingSession()
    let draft!: ReturnType<typeof usePlaylistEditorDraft>
    const Child = defineComponent({
      setup() {
        draft = usePlaylistEditorDraft()
        draft.field.value = 'tags'
        return () =>
          h(StudioPlaylistActions, {
            playlist,
            feature: {
              state,
              actions,
              availability: { status: 'available' },
              status: { status: 'ready' },
            },
            onClose: close,
          })
      },
    })
    const view = mountStudio(
      defineComponent({
        setup() {
          provideEditingSession(editing)
          provideConfirmationDialog()
          return () => h(Child)
        },
      }),
      {},
    )
    const button = (label: string) =>
      findStudioNode(
        view.root,
        (node) =>
          node.tag === 'button' &&
          (node.textContent.trim() === label || node.props['aria-label'] === label),
      )
    const submit = async () => {
      invokeStudio(
        findStudioNode(view.root, (node) => node.tag === 'form'),
        'onSubmit',
        { preventDefault() {} },
      )
      await nextTick()
      await nextTick()
    }
    try {
      actions.addPlaylistTag.mockImplementationOnce(() => {
        throw new Error('disk full')
      })
      draft.tag.value = '夜晚'
      await submit()
      expect(view.root.textContent).toContain('disk full')
      expect(draft.tag.value).toBe('夜晚')
      await submit()
      expect(actions.addPlaylistTag).toHaveBeenLastCalledWith('p', '夜晚')
      expect(draft.tag.value).toBe('')
      invokeStudio(button('移除标签 通勤'), 'onClick')
      await nextTick()
      expect(actions.removePlaylistTag).toHaveBeenCalledExactlyOnceWith('p', '通勤')
      state.playlistTagsAvailable = false
      await nextTick()
      expect(button('添加标签').props.disabled).toBe(true)
      invokeStudio(button('取消'), 'onClick')
      await nextTick()
      expect(close).not.toHaveBeenCalled()
      const dialog = findStudioNode(view.root, (node) => 'data-dialog-open' in node.props)
      expect(dialog.props['data-dialog-open']).toBe(false)
      invokeStudio(dialog, 'onFinish')
      expect(close).toHaveBeenCalledOnce()
    } finally {
      view.unmount()
      editing.dispose()
    }
  })
})
