import type {
  CustomTrackDefinition,
  DownloadHistoryBatch,
  LibraryTrackRecord,
  Track,
} from '@any-music/core'
import {
  createCatalogTrackFilterState,
  createFavoriteFilterState,
  UI_CONTRIBUTIONS,
} from '@any-music/ui'
import {
  createEditingSession,
  provideEditingSession,
  provideConfirmationDialog,
} from '@any-music/ui/library'
import type {
  UiThemeAvailability,
  UiThemeStatus,
  UiThemeTrackListActions,
  UiThemeTrackListState,
  UiThemeCollectionState,
  UiThemeCollectionActions,
} from '@any-music/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, shallowReactive, shallowRef } from 'vue'
import type { Component } from 'vue'

import { definition } from '../../../src/vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

const dialogLeave = vi.hoisted(() => ({ manual: false }))

// The Node renderer exercises control contracts; real overlay focus/layout is checked in T13.
vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  const passthrough = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.(),
  })
  const transition = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_, { attrs, slots }) =>
      () =>
        String(attrs.name).startsWith('queue-view-')
          ? vue.h(
              'div',
              {
                'data-transition-name': attrs.name,
                onBeforeLeave: attrs.onBeforeLeave,
                onBeforeEnter: attrs.onBeforeEnter,
                onAfterEnter: attrs.onAfterEnter,
              },
              slots.default?.(),
            )
          : slots.default?.(),
  })
  return { ...vue, Teleport: passthrough, Transition: transition, TransitionGroup: passthrough }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title'],
      setup:
        (props, { slots }) =>
        () =>
          props.open
            ? vue.h('section', { 'aria-label': props.title }, [slots.default?.(), slots.footer?.()])
            : null,
    }),
  }
})
vi.mock('@any-music/ui/components/SidePanel.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? vue.h('aside', { 'aria-label': props.title }, slots.default?.()) : null,
    }),
  }
})
// Crop geometry is tested in UI; keep its confirmation intent executable in this editor suite.
vi.mock('@any-music/ui/components/PlaylistCoverCropDialog.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['source'],
      emits: ['confirm'],
      setup:
        (props, { emit }) =>
        () =>
          props.source
            ? vue.h(
                'button',
                {
                  type: 'button',
                  onClick: () => emit('confirm', { x: 0, y: 0, width: 800, height: 500 }),
                },
                '使用此封面',
              )
            : null,
    }),
  }
})
vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title'],
      emits: ['close', 'afterLeave'],
      setup(props, { slots, emit }) {
        // Finish the CSS leave lifecycle without a browser; dedicated tests control this separately.
        vue.watch(
          () => props.open,
          (open, previous) => {
            if (previous && !open && !dialogLeave.manual) emit('afterLeave')
          },
        )
        return () =>
          props.open || dialogLeave.manual
            ? vue.h(
                'section',
                {
                  'aria-label': props.title,
                  'data-dialog-open': props.open,
                  onClose: () => emit('close'),
                  onFinishLeave: () => emit('afterLeave'),
                },
                slots.default?.(),
              )
            : null
      },
    }),
  }
})
beforeEach(() => {
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const tracks: Track[] = ['one', 'two'].map((id) => ({
  id,
  title: id,
  artists: [],
  source: { pluginId: 'source', resourceId: id, mediaKind: 'audio' },
}))
function list(): UiThemeTrackListState & UiThemeCollectionState {
  return {
    arrangementMode: 'flat',
    mobileLayout: false,
    platformOrder: ['source'],
    totalCount: 2,
    platformTrackCounts: new Map([['source', 2]]),
    tracks,
    selectedTrackIds: [],
    invalidTrackIds: [],
    favoriteTrackIds: [],
    queuedTrackIds: [],
    downloadedTrackIds: [],
    platformNames: new Map(),
    customNamesByTrackId: new Map(),
    customTagsByTrackId: new Map(),
    addedAtMsByTrackId: new Map(),
    displayMode: 'standard',
    mobileColumns: 1,
    filters: createCatalogTrackFilterState(),
    filterDraft: null,
  }
}
function actions(state: UiThemeTrackListState) {
  return {
    setArrangementMode: vi.fn(),
    moveTrack: vi.fn(),
    movePlatform: vi.fn(),
    play: vi.fn(),
    download: vi.fn(),
    toggleFavorite: vi.fn(),
    select: vi.fn((ids: readonly string[]) => {
      state.selectedTrackIds = ids
    }),
    setFilterDraft: vi.fn((draft: UiThemeTrackListState['filterDraft']) => {
      state.filterDraft = draft
    }),
    applyFilters: vi.fn(() => {
      if (state.filterDraft) state.filters = state.filterDraft
      state.filterDraft = null
    }),
    cancelFilters: vi.fn(() => {
      state.filterDraft = null
    }),
    showTrackActions: vi.fn(),
    enqueue: vi.fn(),
    rename: vi.fn(),
    addToPlaylist: vi.fn(),
    useAsMaterial: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    setDisplayMode: vi.fn(),
    setMobileColumns: vi.fn(),
  } satisfies UiThemeTrackListActions & UiThemeCollectionActions
}
function feature<State, Actions>(state: State, commands: Actions) {
  return shallowReactive({
    state,
    actions: commands,
    availability: { status: 'available' } as UiThemeAvailability,
    status: { status: 'ready' } as UiThemeStatus,
  })
}
function mountRoot(component: Component, model: unknown) {
  const generation = shallowRef(0)
  let confirmation!: ReturnType<typeof provideConfirmationDialog>
  const editing = createEditingSession()
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        confirmation = provideConfirmationDialog()
        provideEditingSession(editing)
        provide(UI_CONTRIBUTIONS, { resolve: () => [], accepts: () => false })
        return () => h(component, { feature: model, key: generation.value })
      },
    }),
    {},
  )
  const button = (text: string) =>
    findCatalogElement(
      view.root,
      (node) =>
        node.tag === 'button' &&
        (node.textContent.trim() === text || node.props['aria-label'] === text),
    )
  return {
    ...view,
    button,
    confirmation,
    replace: async () => {
      generation.value++
      await nextTick()
    },
    close: () => {
      view.unmount()
      editing.dispose()
    },
  }
}

describe('complete-root classic library contracts', () => {
  it.each(['queue', 'favorites'] as const)(
    'places one icon display picker before the %s mobile filter and targets the active region',
    async (context) => {
      const state = shallowReactive({
        ...list(),
        currentTrackId: null,
        mobileLayout: true,
        arrangementMode: 'flat' as 'flat' | 'platform',
        displayPreferences: {
          flat: { displayMode: 'comfortable' as const, mobileColumns: 1 as const },
          'platform:source': { displayMode: 'compact' as const, mobileColumns: 2 as const },
        },
      })
      const commands = { ...actions(state), remove: vi.fn(), reorder: vi.fn(), clear: vi.fn() }
      const view = mountRoot(definition.views[context], feature(state, commands))
      try {
        const trigger = view.button('歌曲展示方式')
        expect(trigger.textContent).not.toContain('展示')
        expect(
          trigger.parent?.children
            .filter((child) => child.tag === 'button')
            .map((child) => child.props['aria-label']),
        ).toEqual(['歌曲展示方式', '筛选歌曲', '操作器 已选 0'])
        expect(view.root.querySelectorAll('[aria-label="选择歌曲展示方式"]')).toHaveLength(0)
        dispatchCatalogEvent(trigger, 'onClick', false)
        await nextTick()
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.props['data-display-section'] === 'arrangement',
          ),
          'onClick',
          false,
        )
        await nextTick()
        expect(
          findCatalogElement(
            view.root,
            (node) => node.tag === 'button' && node.props['data-mode'] === 'density:comfortable',
          ).props['aria-pressed'],
        ).toBe(true)
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.tag === 'button' && node.props['data-mode'] === 'density:compact',
          ),
          'onClick',
          false,
        )
        expect(commands.setDisplayMode).toHaveBeenLastCalledWith('compact', 'flat')
        state.arrangementMode = 'platform'
        await nextTick()
        dispatchCatalogEvent(
          findCatalogElement(view.root, (node) => node.props['data-collection-entry'] === 'source'),
          'onClick',
          false,
        )
        await nextTick()
        dispatchCatalogEvent(view.button('歌曲展示方式'), 'onClick', false)
        await nextTick()
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.props['data-display-section'] === 'arrangement',
          ),
          'onClick',
          false,
        )
        await nextTick()
        expect(
          findCatalogElement(
            view.root,
            (node) => node.tag === 'button' && node.props['data-mode'] === 'density:compact',
          ).props['aria-pressed'],
        ).toBe(true)
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.tag === 'button' && node.props['data-mode'] === 'density:comfortable',
          ),
          'onClick',
          false,
        )
        expect(commands.setDisplayMode).toHaveBeenLastCalledWith('comfortable', 'platform:source')
      } finally {
        view.close()
      }
    },
  )

  it.each(['queue', 'favorites'] as const)(
    'slides into a %s platform and restores overview scroll and focus after returning',
    async (context) => {
      const state = shallowReactive({
        ...list(),
        currentTrackId: null,
        arrangementMode: 'platform' as const,
      })
      const commands = { ...actions(state), remove: vi.fn(), reorder: vi.fn(), clear: vi.fn() }
      const scroll = { scrollTop: 480 }
      const originalClosest = CatalogTestElement.prototype.closest
      // The semantic bridge reads its owner during mount. Supply it before mounting,
      // rather than changing an untracked DOM lookup after its computed value was read.
      vi.spyOn(CatalogTestElement.prototype, 'closest').mockImplementation(function (
        this: CatalogTestElement,
        selectors: string,
      ) {
        return selectors === '.music-app-shell__content'
          ? (scroll as unknown as CatalogTestElement)
          : originalClosest.call(this, selectors)
      })
      const view = mountRoot(definition.views[context], feature(state, commands))
      const section = findCatalogElement(view.root, (node) => node.tag === 'section')
      const transition = () =>
        findCatalogElement(view.root, (node) => 'data-transition-name' in node.props)
      const page = () =>
        findCatalogElement(view.root, (node) => 'data-collection-view' in node.props)
      const overview = page()
      const entry = findCatalogElement(
        view.root,
        (node) => node.props['data-collection-entry'] === 'source',
      )
      const leave = transition().props.onBeforeLeave as (element: Element) => void
      Object.assign(view.root, { activeElement: entry })
      Object.assign(overview, { contains: (element: unknown) => element === entry })
      leave(overview as unknown as Element)
      expect(overview.props.inert).toBe('')
      expect(overview.props['aria-hidden']).toBe('true')
      expect(section.isFocused).toBe(true)
      dispatchCatalogEvent(entry, 'onClick', false)
      await nextTick()
      expect(transition().props['data-transition-name']).toBe('queue-view-forward')
      const detail = page()
      expect(detail).not.toBe(overview)
      expect(detail.props['data-collection-view']).toBe('detail:source')
      const enter = () => {
        const node = page()
        Object.assign(node, { isConnected: true })
        const beforeEnter = transition().props.onBeforeEnter as (element: Element) => void
        beforeEnter(node as unknown as Element)
      }
      const finish = async () => {
        const afterEnter = transition().props.onAfterEnter as (element: Element) => Promise<void>
        await afterEnter(page() as unknown as Element)
      }
      enter()
      expect(scroll.scrollTop).toBe(0)
      const heading = findCatalogElement(detail, (node) => 'data-collection-focus' in node.props)
      expect(heading.isFocused).toBe(false)
      await finish()
      expect(heading.isFocused).toBe(true)
      dispatchCatalogEvent(view.button('筛选歌曲'), 'onClick', false)
      await nextTick()
      expect(view.root.textContent).not.toContain('平台筛选')
      commands.cancelFilters()
      await nextTick()
      scroll.scrollTop = 120
      dispatchCatalogEvent(view.button('返回按平台'), 'onClick', false)
      await nextTick()
      expect(transition().props['data-transition-name']).toBe('queue-view-back')
      expect(page().props['data-collection-view']).toBe('overview')
      dispatchCatalogEvent(view.button('筛选歌曲'), 'onClick', false)
      await nextTick()
      expect(view.root.textContent).toContain('平台筛选')
      commands.cancelFilters()
      await nextTick()
      enter()
      expect(scroll.scrollTop).toBe(480)
      scroll.scrollTop = 200
      await finish()
      expect(scroll.scrollTop).toBe(480)
      expect(
        findCatalogElement(view.root, (node) => node.props['data-collection-entry'] === 'source')
          .isFocused,
      ).toBe(true)
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['data-collection-entry'] === 'source'),
        'onClick',
        false,
      )
      await nextTick()
      enter()
      dispatchCatalogEvent(view.button('歌曲展示方式'), 'onClick', false)
      await nextTick()
      await finish()
      expect(
        findCatalogElement(page(), (node) => 'data-collection-focus' in node.props).isFocused,
      ).toBe(false)
      view.close()
    },
  )

  it('keeps platform navigation, selection, playback scope and keyboard ordering host-controlled', async () => {
    const third: Track = {
      ...tracks[0]!,
      id: 'three',
      title: 'three',
      source: { pluginId: 'other', resourceId: 'three', mediaKind: 'audio' },
    }
    const state = shallowReactive({
      ...list(),
      tracks: [...tracks, third],
      currentTrackId: null,
      arrangementMode: 'platform' as 'flat' | 'platform',
      platformOrder: ['source', 'other'],
      platformTrackCounts: new Map([
        ['source', 2],
        ['other', 1],
      ]),
      totalCount: 3,
      selectedTrackIds: ['three'],
    })
    const commands = { ...actions(state), remove: vi.fn(), reorder: vi.fn(), clear: vi.fn() }
    const view = mountRoot(definition.views.queue, feature(state, commands))
    expect(view.root.textContent).not.toContain('喜欢筛选')
    const card = findCatalogElement(
      view.root,
      (node) => node.props['data-queue-drop-id'] === 'source',
    )
    const handlers = card.props.onKeydown as ((event: unknown) => void)[]
    handlers.forEach((handler) =>
      handler({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} }),
    )
    expect(commands.movePlatform).toHaveBeenCalledExactlyOnceWith('source', 'other', [
      'source',
      'other',
    ])
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['data-collection-entry'] === 'source'),
      'onClick',
      false,
    )
    await nextTick()
    dispatchCatalogEvent(view.button('操作器 已选 0'), 'onClick', false)
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '全选当前 2 首匹配歌曲'),
      'onChange',
      false,
    )
    await nextTick()
    expect(commands.select).toHaveBeenCalledExactlyOnceWith(['three', 'one', 'two'])
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['data-am-focus-key'] === 'track:one:play'),
      'onClick',
      false,
    )
    expect(commands.play).toHaveBeenCalledExactlyOnceWith('one', ['one', 'two'])
    await view.replace()
    expect(view.button('返回按平台')).toBeTruthy()
    expect(commands.select).toHaveBeenCalledTimes(1)
    dispatchCatalogEvent(view.button('返回按平台'), 'onClick', false)
    await nextTick()
    expect(
      findCatalogElement(view.root, (node) => node.props['data-collection-entry'] === 'other'),
    ).toBeTruthy()
    view.close()
  })

  it('requires the operator before selecting and retains its mode across remounts', async () => {
    const state = shallowReactive({ ...list(), currentTrackId: null })
    const commands = { ...actions(state), remove: vi.fn(), reorder: vi.fn(), clear: vi.fn() }
    const view = mountRoot(definition.views.queue, feature(state, commands))
    try {
      const checkbox = () =>
        findCatalogElement(
          view.root,
          (node) => node.props['data-am-focus-key'] === 'track:one:select',
        )
      expect(() => checkbox()).toThrow()
      const cover = findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.props['data-queue-handle'] !== undefined,
      )
      dispatchCatalogEvent(cover, 'onClick', false)
      expect(commands.select).not.toHaveBeenCalled()
      dispatchCatalogEvent(view.button('操作器 已选 0'), 'onClick', false)
      await nextTick()
      dispatchCatalogEvent(checkbox(), 'onChange', false)
      await nextTick()
      expect(state.selectedTrackIds).toEqual(['one'])
      await view.replace()
      expect(checkbox().props.checked).toBe(true)
      dispatchCatalogEvent(checkbox(), 'onChange', false)
      await nextTick()
      expect(view.button('操作器 已选 0').props['aria-expanded']).toBe(true)
      dispatchCatalogEvent(checkbox(), 'onChange', false)
      await nextTick()
      dispatchCatalogEvent(view.button('操作器 已选 1'), 'onClick', false)
      await nextTick()
      expect(state.selectedTrackIds).toEqual([])
      expect(() => checkbox()).toThrow()
    } finally {
      view.close()
    }
  })

  it('uses host selection, reorder and filter drafts without writes on mount/replacement', async () => {
    const state = shallowReactive({ ...list(), currentTrackId: 'one' })
    const commands = { ...actions(state), remove: vi.fn(), reorder: vi.fn(), clear: vi.fn() }
    const view = mountRoot(definition.views.queue, feature(state, commands))
    dispatchCatalogEvent(
      view.button('操作器 已选 ' + state.selectedTrackIds.length),
      'onClick',
      false,
    )
    await nextTick()
    expect(view.root.textContent).not.toContain('清空列表')
    expect(Object.values(commands).every((command) => command.mock.calls.length === 0)).toBe(true)
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '全选当前 2 首匹配歌曲'),
      'onChange',
      false,
    )
    await nextTick()
    expect(commands.select).toHaveBeenCalledExactlyOnceWith(['one', 'two'])
    const cover = findCatalogElement(view.root, (node) =>
      String(node.props['aria-label']).includes('歌曲 two；'),
    )
    const handlers = cover.props.onKeydown as ((event: unknown) => void)[]
    handlers.forEach((handler) =>
      handler({ key: 'ArrowUp', preventDefault() {}, stopPropagation() {} }),
    )
    expect(commands.moveTrack).toHaveBeenCalledExactlyOnceWith('two', 'one', ['one', 'two'])
    dispatchCatalogEvent(view.button('筛选歌曲'), 'onClick', false)
    await nextTick()
    const draft = state.filterDraft
    await view.replace()
    expect(state.filterDraft).toBe(draft)
    expect(commands.applyFilters).not.toHaveBeenCalled()
    dispatchCatalogEvent(view.button('取消'), 'onClick', false)
    expect(commands.cancelFilters).toHaveBeenCalledTimes(1)
    expect(state.selectedTrackIds).toEqual(['one', 'two'])
    view.close()
  })

  it('confirms a batch download, rejects stale removals and keeps invalid-track actions disabled', async () => {
    const state = shallowReactive({
      ...list(),
      currentTrackId: null,
      selectedTrackIds: ['one', 'two'],
      invalidTrackIds: ['two'],
    })
    const commands = { ...actions(state), remove: vi.fn(), reorder: vi.fn(), clear: vi.fn() }
    const view = mountRoot(definition.views.queue, feature(state, commands))
    dispatchCatalogEvent(
      view.button('操作器 已选 ' + state.selectedTrackIds.length),
      'onClick',
      false,
    )
    await nextTick()
    dispatchCatalogEvent(view.button('下载已选歌曲'), 'onClick', false)
    expect(commands.download).not.toHaveBeenCalled()
    view.confirmation.accept()
    await nextTick()
    expect(commands.download).toHaveBeenCalledExactlyOnceWith(['one'])
    dispatchCatalogEvent(view.button('将已选歌曲移出待听'), 'onClick', false)
    await view.replace()
    view.confirmation.accept()
    await nextTick()
    expect(commands.remove).not.toHaveBeenCalled()
    view.close()
  })

  it('adapts favorite membership and platform grouping through named actions', async () => {
    const state = shallowReactive({
      ...list(),
      selectedTrackIds: ['one', 'two'],
      favoriteTrackIds: ['one'],
      favoriteFilters: createFavoriteFilterState(),
      favoriteFilterDraft: null,
      platformOrder: ['source', 'other'],
    })
    const commands = {
      ...actions(state),
      setFavoriteFilterDraft: vi.fn(),
      applyFavoriteFilters: vi.fn(),
      cancelFavoriteFilters: vi.fn(),
      reorderPlatforms: vi.fn(),
    }
    const view = mountRoot(definition.views.favorites, feature(state, commands))
    expect(view.root.textContent).not.toContain('喜欢筛选')
    dispatchCatalogEvent(
      view.button('操作器 已选 ' + state.selectedTrackIds.length),
      'onClick',
      false,
    )
    await nextTick()
    expect(view.root.textContent).not.toContain('清空列表')
    dispatchCatalogEvent(view.button('按平台'), 'onClick', false)
    expect(commands.setArrangementMode).toHaveBeenCalledExactlyOnceWith('platform')
    dispatchCatalogEvent(view.button('将已选歌曲添加到我的喜欢'), 'onClick', false)
    view.confirmation.accept()
    await nextTick()
    expect(commands.toggleFavorite).toHaveBeenCalledExactlyOnceWith('two')
    view.close()
  })

  it('creates playlists from a dialog and rejects a stale deletion after opening another detail', async () => {
    const playlists = ['p', 'q'].map((id) => ({
      id,
      name: id,
      trackIds: ['one'],
      createdAtMs: 1,
      updatedAtMs: 1,
    }))
    const state = shallowReactive({
      ...list(),
      playlists,
      activePlaylistId: null as string | null,
      query: '',
      nameDraft: '',
      coverUrls: {},
    })
    const commands = {
      ...actions(state),
      open: vi.fn((id: string | null) => {
        state.activePlaylistId = id
      }),
      create: vi.fn(),
      setQuery: vi.fn(),
      setNameDraft: vi.fn((name: string) => {
        state.nameDraft = name
      }),
      renamePlaylist: vi.fn(),
      updateDescription: vi.fn(),
      saveDetails: vi.fn(),
      reorderPlaylists: vi.fn(),
      remove: vi.fn(),
      removeTracks: vi.fn(),
      reorderTracks: vi.fn(),
    }
    const view = mountRoot(definition.views.playlists, feature(state, commands))
    dispatchCatalogEvent(view.button('创建'), 'onClick', false)
    await nextTick()
    state.nameDraft = '新歌单'
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
      false,
    )
    expect(commands.create).toHaveBeenCalledExactlyOnceWith('新歌单', '', undefined)
    await nextTick()
    dispatchCatalogEvent(view.button('查看 p 的详细信息'), 'onClick', false)
    await nextTick()
    dispatchCatalogEvent(view.button('删除歌单'), 'onClick', false)
    dispatchCatalogEvent(view.button('查看 q 的详细信息'), 'onClick', false)
    await nextTick()
    view.confirmation.accept()
    await nextTick()
    expect(commands.remove).not.toHaveBeenCalled()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['data-playlist-field'] === 'name'),
      'onClick',
      false,
    )
    await nextTick()
    expect(view.button('保存').props.disabled).toBe(true)
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
      false,
    )
    expect(commands.saveDetails).not.toHaveBeenCalled()
    state.nameDraft = 'q updated'
    await nextTick()
    expect(view.button('保存').props.disabled).toBe(false)
    state.nameDraft = 'q'
    await nextTick()
    expect(view.button('保存').props.disabled).toBe(true)
    state.nameDraft = 'q updated'
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
      false,
    )
    expect(commands.saveDetails).toHaveBeenCalledExactlyOnceWith('q', 'q updated', '', undefined)
    view.close()
  })

  it('exposes separate playlist fields and routes favorite, download and JSON export by playlist ID', async () => {
    const state = shallowReactive({
      ...list(),
      playlists: [{ id: 'p', name: 'Mix', trackIds: ['one'], createdAtMs: 1, updatedAtMs: 1 }],
      activePlaylistId: null as string | null,
      query: '',
      nameDraft: '',
      coverUrls: {},
      playCountByPlaylistId: new Map([['p', 12]]),
      transferBusy: false,
    })
    const commands = {
      ...actions(state),
      open: vi.fn(),
      create: vi.fn(),
      remove: vi.fn(),
      saveDetails: vi.fn(),
      setQuery: vi.fn(),
      updateDescription: vi.fn(),
      reorderPlaylists: vi.fn(),
      renamePlaylist: vi.fn(),
      removeTracks: vi.fn(),
      reorderTracks: vi.fn(),
      setNameDraft: (name: string) => {
        state.nameDraft = name
      },
      favoritePlaylist: vi.fn(),
      downloadPlaylist: vi.fn(),
      exportFile: vi.fn(async () => {}),
    }
    const view = mountRoot(definition.views.playlists, feature(state, commands))
    try {
      dispatchCatalogEvent(view.button('查看 Mix 的详细信息'), 'onClick', false)
      await nextTick()
      expect(view.root.textContent).toContain('创建于')
      const summary = findCatalogElement(
        view.root,
        (node) => node.props.class === 'playlist-editor__summary-card',
      )
      expect(summary.textContent).not.toContain('Mix')
      expect(summary.textContent).toContain('听歌次数 12 次')
      state.playCountByPlaylistId = new Map([['p', 13]])
      await nextTick()
      expect(summary.textContent).toContain('听歌次数 13 次')
      const primary = findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '歌单常用操作',
      )
      expect(
        primary.children
          .filter((node) => node.tag === 'button')
          .map((node) => node.props['aria-label']),
      ).toEqual(['全部喜欢', '下载歌单', '导出歌单'])
      expect(primary.textContent).toBe('喜欢下载导出')
      expect(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === 'Mix').textContent,
      ).not.toContain('取消')
      dispatchCatalogEvent(view.button('全部喜欢'), 'onClick', false)
      await nextTick()
      expect(commands.favoritePlaylist).toHaveBeenCalledExactlyOnceWith('p')
      dispatchCatalogEvent(view.button('下载歌单'), 'onClick', false)
      await nextTick()
      expect(commands.downloadPlaylist).toHaveBeenCalledExactlyOnceWith('p')
      const row = (label: string) =>
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent.startsWith(label),
        )
      dispatchCatalogEvent(row('歌单简介'), 'onClick', false)
      await nextTick()
      expect(view.button('保存').props.disabled).toBe(true)
      const description = findCatalogElement(view.root, (node) => node.tag === 'textarea')
      ;(description.props['onUpdate:modelValue'] as (value: string) => void)('通勤')
      await nextTick()
      expect(view.button('保存').props.disabled).toBe(false)
      ;(description.props['onUpdate:modelValue'] as (value: string) => void)('')
      await nextTick()
      expect(view.button('保存').props.disabled).toBe(true)
      ;(description.props['onUpdate:modelValue'] as (value: string) => void)('通勤')
      dispatchCatalogEvent(view.button('返回歌单操作'), 'onClick', false)
      await nextTick()
      dispatchCatalogEvent(row('歌单名称'), 'onClick', false)
      await nextTick()
      expect(view.root.querySelectorAll('textarea')).toHaveLength(0)
      dispatchCatalogEvent(view.button('返回歌单操作'), 'onClick', false)
      await nextTick()
      dispatchCatalogEvent(row('歌单简介'), 'onClick', false)
      await nextTick()
      expect(findCatalogElement(view.root, (node) => node.tag === 'textarea').value).toBe('通勤')
      dispatchCatalogEvent(view.button('返回歌单操作'), 'onClick', false)
      await nextTick()
      dispatchCatalogEvent(view.button('导出歌单'), 'onClick', false)
      await nextTick()
      expect(view.root.textContent).toContain('不包含音频文件、本地封面和账号数据')
      dispatchCatalogEvent(view.button('导出 JSON 文件'), 'onClick', false)
      await nextTick()
      expect(commands.exportFile).toHaveBeenCalledExactlyOnceWith('p')
    } finally {
      view.close()
    }
  })

  it.each([false, true])(
    'keeps playlist editing and collection controls reachable (mobile: %s)',
    async (mobileLayout) => {
      const state = shallowReactive({
        ...list(),
        playlists: [{ id: 'p', name: 'Mix', trackIds: ['one'], createdAtMs: 1, updatedAtMs: 1 }],
        mobileLayout,
        activePlaylistId: null as string | null,
        query: '',
        nameDraft: '',
        coverUrls: {},
      })
      const commands = {
        ...actions(state),
        create: vi.fn(),
        saveDetails: vi.fn(),
        remove: vi.fn(),
        removeTracks: vi.fn(),
        reorderTracks: vi.fn(),
        renamePlaylist: vi.fn(),
        updateDescription: vi.fn(),
        reorderPlaylists: vi.fn(),
        setQuery: vi.fn(),
        setNameDraft: vi.fn((name: string) => {
          state.nameDraft = name
        }),
        open: vi.fn((id: string | null) => {
          state.activePlaylistId = id
        }),
      }
      const view = mountRoot(definition.views.playlists, feature(state, commands))
      dispatchCatalogEvent(view.button('选择歌单展示方式'), 'onClick', false)
      await nextTick()
      expect(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === '歌单展示方式'),
      ).toBeDefined()
      expect(view.root.textContent).not.toContain('风格选择')
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.props['data-display-section'] === 'arrangement',
        ),
        'onClick',
        false,
      )
      await nextTick()
      const compact = findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.props['data-mode'] === 'density:compact',
      )
      dispatchCatalogEvent(compact, 'onClick', false)
      expect(commands.setDisplayMode).toHaveBeenCalledExactlyOnceWith('compact')
      dispatchCatalogEvent(view.button('创建'), 'onClick', false)
      await nextTick()
      state.nameDraft = ' ＭＩＸ '
      await nextTick()
      expect(view.root.textContent).toContain('已存在同名歌单')
      expect(view.button('创建歌单').props.disabled).toBe(true)
      const fileInput = findCatalogElement(
        view.root,
        (node) => node.tag === 'input' && node.props['aria-label'] === '上传歌单封面',
      )
      expect(fileInput.props.accept).toContain('.webp')
      expect(fileInput.props.accept).not.toContain('image/*')
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.tag === 'form'),
        'onSubmit',
        false,
      )
      expect(commands.create).not.toHaveBeenCalled()
      const description = findCatalogElement(view.root, (node) => node.tag === 'textarea')
      ;(description.props['onUpdate:modelValue'] as (value: string) => void)('未提交的简介')
      await view.replace()
      expect(view.button('创建歌单').props.disabled).toBe(true)
      expect(findCatalogElement(view.root, (node) => node.tag === 'textarea').value).toBe(
        '未提交的简介',
      )
      dispatchCatalogEvent(view.button('取消'), 'onClick', false)
      await nextTick()
      dispatchCatalogEvent(view.button('Mix'), 'onClick', false)
      await nextTick()
      await nextTick()
      expect(view.root.textContent).toContain('全部歌曲')
      expect(view.root.textContent).toContain('按平台')
      const songCover = findCatalogElement(
        view.root,
        (node) =>
          node.tag === 'button' && String(node.props['aria-label']).startsWith('排序歌曲 one'),
      )
      const moveKeys = songCover.props.onKeydown as ((event: unknown) => void)[]
      moveKeys.forEach((handler) =>
        handler({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} }),
      )
      expect(commands.moveTrack).toHaveBeenCalledExactlyOnceWith('one', 'two', ['one', 'two'])
      expect(view.root.textContent).not.toContain('长按封面调整歌单中的歌曲顺序')
      const heading = findCatalogElement(view.root, (node) =>
        String(node.props.class).includes('playlist-track-heading__heading'),
      )
      expect(heading.textContent).not.toContain('共 2 首')
      expect(view.root.querySelectorAll('[aria-label="收起列表信息"]')).toHaveLength(0)
      const back = view.button('返回我的歌单')
      const arrangement = findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === 'Mix排列方式',
      )
      expect(back.parent).toBe(arrangement.parent)
      expect(back.parent?.children.indexOf(back)).toBeLessThan(
        back.parent!.children.indexOf(arrangement),
      )
      const info = view.button('歌单信息')
      expect(view.root.querySelectorAll('[aria-label="歌单信息"]')).toHaveLength(1)
      expect(info.parent).toBe(view.button('歌曲展示方式').parent)
      expect(
        info.parent?.children
          .filter((child) => child.tag === 'button')
          .map((child) => child.props['aria-label']),
      ).toEqual(['歌单信息', '歌曲展示方式', '筛选歌曲', '操作器 已选 0'])
      if (mobileLayout) {
        expect(info.textContent).not.toContain('歌单信息')
        expect(view.root.querySelectorAll('[aria-label="选择歌曲展示方式"]')).toHaveLength(0)
      } else {
        expect(info.textContent).toContain('歌单信息')
      }
      dispatchCatalogEvent(info, 'onClick', false)
      await nextTick()
      expect(commands.setNameDraft).toHaveBeenLastCalledWith('Mix')
      expect(findCatalogElement(view.root, (node) => node.tag === 'form')).toBeDefined()
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === 'Mix'),
        'onClose',
        false,
      )
      await nextTick()
      const transition = findCatalogElement(
        view.root,
        (node) => node.props['data-transition-name'] === 'queue-view-forward',
      )
      expect(transition).toBeDefined()
      state.arrangementMode = 'platform'
      await nextTick()
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['data-collection-entry'] === 'source'),
        'onClick',
        false,
      )
      await nextTick()
      expect(view.root.querySelectorAll('[aria-label="歌单信息"]')).toHaveLength(1)
      dispatchCatalogEvent(view.button('歌单信息'), 'onClick', false)
      await nextTick()
      expect(findCatalogElement(view.root, (node) => node.tag === 'form')).toBeDefined()
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === 'Mix'),
        'onClose',
        false,
      )
      await nextTick()
      dispatchCatalogEvent(view.button('返回按平台'), 'onClick', false)
      await nextTick()
      dispatchCatalogEvent(view.button('我的歌单'), 'onClick', false)
      await nextTick()
      await nextTick()
      expect(
        findCatalogElement(
          view.root,
          (node) => node.props['data-transition-name'] === 'queue-view-back',
        ),
      ).toBeDefined()
      view.close()
    },
  )

  it.each(
    (['favorites', 'playlists', 'downloads'] as const).flatMap(
      (context) =>
        [
          [context, 'same row forward', 3, 'p', 'q', ['q', 'p', 'r']],
          [context, 'same row backward', 3, 'q', 'p', ['q', 'p', 'r']],
          [context, 'across rows forward', 2, 'p', 'r', ['q', 'r', 'p']],
          [context, 'across rows backward', 2, 'r', 'p', ['r', 'p', 'q']],
        ] as const,
    ),
  )(
    'keeps %s cards and partially shifted neighbors stable after a quick drop: %s',
    async (context, _label, columns, source, target, order) => {
      vi.useFakeTimers()
      vi.stubGlobal('Element', CatalogTestElement)
      vi.stubGlobal(
        'ShadowRoot',
        class {
          host = null
        },
      )
      vi.stubGlobal('window', Object.assign(new EventTarget(), { innerHeight: 600 }))
      vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '340ms' }))
      const frames = new Map<number, FrameRequestCallback>()
      let frameId = 0
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++frameId, callback)
        return frameId
      })
      vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
      const originalIds = ['p', 'q', 'r']
      const batch: DownloadHistoryBatch = {
        id: 'batch',
        status: 'completed',
        startedAtMs: 1,
        concurrency: 1,
        origin: { kind: 'queue', label: '待听' },
        items: originalIds.map((id) => ({
          id,
          track: { ...tracks[0]!, id, title: id },
          status: 'paused',
          requestedAtMs: 1,
          maxRetryCount: 3,
          attempts: [],
        })),
      }
      const state = shallowReactive({
        ...list(),
        tracks: originalIds.map((id) => ({ ...tracks[0]!, id, title: id })),
        favoriteTrackIds: originalIds,
        batches: [batch],
        itemOrder: originalIds,
        selectedItemIds: [],
        concurrency: 1,
        statusFilter: 'all',
        playlists: originalIds.map((id) => ({
          id,
          name: id,
          trackIds: ['one'],
          createdAtMs: 1,
          updatedAtMs: 1,
        })),
        activePlaylistId: null,
        nameDraft: '',
        query: '',
        coverUrls: {},
      })
      const commands = {
        ...actions(state),
        open: vi.fn(),
        reorderPlaylists: vi.fn((ids: readonly string[]) => {
          model.state = {
            ...model.state,
            playlists: ids.map((id) => model.state.playlists.find((item) => item.id === id)!),
          }
        }),
        moveItem: vi.fn(() => {
          model.state = { ...model.state, itemOrder: [...order] }
        }),
        moveTrack: vi.fn(() => {
          model.state = {
            ...model.state,
            tracks: order.map((id) => model.state.tracks.find((track) => track.id === id)!),
          }
        }),
      }
      // Production publishes a fresh projection after committing an order. Mutating only a
      // field on the same state object hides false cancellations in multi-source watchers.
      const model = feature(state, commands)
      const view = mountRoot(definition.views[context], model)
      try {
        await nextTick()
        const grid = findCatalogElement(
          view.root,
          (node) =>
            node.props.class ===
            (context === 'playlists'
              ? 'playlist-overview__grid'
              : context === 'downloads'
                ? 'download-collection'
                : 'listen-queue'),
        )
        const boundsAt = (index: number) => ({
          left: (index % columns) * 220,
          top: Math.floor(index / columns) * 220,
          width: 200,
          height: 200,
        })
        Object.assign(grid, {
          scrollHeight: 0,
          clientHeight: 0,
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 660, height: 440 }),
          setPointerCapture: vi.fn(),
          hasPointerCapture: () => true,
          releasePointerCapture: vi.fn(),
        })
        const rows = () => grid.querySelectorAll('[data-queue-drop-kind="track"]')
        for (const row of rows())
          Object.assign(row, { getBoundingClientRect: () => boundsAt(rows().indexOf(row)) })
        const row = rows().find((node) => node.dataset.queueDropId === source)!
        const tile = row.querySelector('[data-am-grid-motion]')!
        const movingClass =
          context === 'playlists'
            ? 'playlist-tile--moving'
            : context === 'downloads'
              ? 'download-track__surface--moving'
              : 'queue-track__surface--shifted'
        const cover = findCatalogElement(
          row,
          (node) => node.tag === 'button' && 'data-queue-handle' in node.props,
        )
        const from = originalIds.indexOf(source)
        const to = originalIds.indexOf(target)
        const neighbors = rows().filter(
          (node, index) =>
            node !== row && index >= Math.min(from, to) && index <= Math.max(from, to),
        )
        const residuals = new Map(
          neighbors.map((neighbor) => {
            const id = neighbor.dataset.queueDropId!
            const original = boundsAt(originalIds.indexOf(id))
            const destination = boundsAt(order.indexOf(id as 'p' | 'q' | 'r'))
            const dx = (destination.left - original.left) / 2
            const dy = (destination.top - original.top) / 2
            // CSS is halfway to the preview slot when the user releases the pointer.
            Object.assign(neighbor.querySelector('[data-am-grid-motion]')!, {
              getBoundingClientRect: () => ({
                ...original,
                left: original.left + dx,
                top: original.top + dy,
              }),
            })
            return [neighbor, `translate3d(${-dx}px, ${-dy}px, 0)`]
          }),
        )
        const pointer = (index: number, offset = 0) => ({
          button: 0,
          pointerId: 1,
          isPrimary: true,
          clientX: boundsAt(index).left + 60 + offset,
          clientY: boundsAt(index).top + 60,
          target: cover,
          currentTarget: cover,
          preventDefault() {},
          stopPropagation() {},
        })
        ;(cover.props.onPointerdown as (event: unknown) => void)(pointer(from))
        vi.advanceTimersByTime(500)
        await nextTick()
        if (context !== 'favorites') expect(tile.props.class).toContain(movingClass)
        grid.dispatchListeners('pointermove', pointer(to, 15))
        const movement = [...frames.values()]
        frames.clear()
        movement.forEach((callback) => callback(16))
        await nextTick()
        grid.dispatchListeners('pointerup', pointer(to, 15))
        await nextTick()
        await nextTick()
        if (context === 'playlists')
          expect(commands.reorderPlaylists).toHaveBeenCalledExactlyOnceWith(order)
        else if (context === 'downloads')
          expect(commands.moveItem).toHaveBeenCalledExactlyOnceWith(source, target, originalIds)
        else expect(commands.moveTrack).toHaveBeenCalledExactlyOnceWith(source, target, originalIds)
        expect(rows()[order.indexOf(source)]).toBe(row)
        expect(row.querySelector('[data-am-grid-motion]')).toBe(tile)
        expect(tile.props.style).toEqual({
          transform: 'translate3d(15px, 0px, 0)',
          transition: 'none',
          contentVisibility: 'visible',
        })
        expect(row.getAttribute('data-am-grid-landing')).toBe('')
        for (const neighbor of neighbors) {
          expect(neighbor.getAttribute('data-am-grid-settling')).toBe('')
          expect(neighbor.querySelector('[data-am-grid-motion]')!.props.style).toEqual({
            transform: residuals.get(neighbor),
            transition: 'none',
            contentVisibility: 'visible',
          })
        }
        for (const callback of frames.values()) callback(16)
        frames.clear()
        await nextTick()
        expect(tile.props.style).toEqual({ contentVisibility: 'visible' })
        expect(tile.props.class).toContain(movingClass)
        for (const neighbor of neighbors) {
          const surface = neighbor.querySelector('[data-am-grid-motion]')!
          expect(surface.props.style).toEqual({ contentVisibility: 'visible' })
          expect(surface.props.class).toContain(movingClass)
        }
        vi.advanceTimersByTime(340)
        await nextTick()
        expect(tile.props.style).toBeUndefined()
        expect(tile.props.class).not.toContain(movingClass)
        expect(row.getAttribute('data-am-grid-landing')).toBeNull()
        for (const neighbor of neighbors) {
          expect(neighbor.getAttribute('data-am-grid-settling')).toBeNull()
          expect(neighbor.querySelector('[data-am-grid-motion]')!.props.style).toBeUndefined()
        }
      } finally {
        view.close()
        vi.useRealTimers()
      }
    },
  )

  it.each([false, true])(
    'filters and operates on playlists without a standalone search (mobile: %s)',
    async (mobileLayout) => {
      const state = shallowReactive({
        ...list(),
        mobileLayout,
        playlists: [
          {
            id: 'p',
            name: 'Mix',
            coverId: 'cover',
            trackIds: ['one', 'two'],
            createdAtMs: 1,
            updatedAtMs: 1,
          },
          { id: 'empty', name: 'Empty', trackIds: [], createdAtMs: 1, updatedAtMs: 1 },
          { id: 'q', name: 'Other', trackIds: ['two'], createdAtMs: 1, updatedAtMs: 1 },
        ],
        activePlaylistId: null as string | null,
        query: '',
        nameDraft: '',
        coverUrls: { cover: 'data:image/jpeg;base64,AA==' },
      })
      const commands = {
        ...actions(state),
        open: vi.fn(),
        create: vi.fn(),
        saveDetails: vi.fn(),
        remove: vi.fn(),
        removeTracks: vi.fn(),
        reorderTracks: vi.fn(),
        renamePlaylist: vi.fn(),
        updateDescription: vi.fn(),
        reorderPlaylists: vi.fn(),
        setQuery: vi.fn(),
        setNameDraft: vi.fn(),
      }
      const view = mountRoot(definition.views.playlists, feature(state, commands))
      try {
        const create = view.button('创建')
        const importButton = view.button('导入歌单')
        expect(importButton.parent).toBe(create.parent)
        expect(importButton.parent?.children.filter((child) => child.tag === 'button')).toEqual([
          importButton,
          create,
        ])
        expect(view.root.querySelectorAll('[placeholder="搜索歌单名称"]')).toHaveLength(0)
        expect(view.root.querySelectorAll('[data-collection-focus]')).toHaveLength(
          mobileLayout ? 0 : 1,
        )
        if (mobileLayout) {
          const display = view.button('选择歌单展示方式')
          expect(display.parent).toBe(view.button('筛选歌单').parent)
          expect(display.parent!.children.indexOf(display) + 1).toBe(
            display.parent!.children.indexOf(view.button('筛选歌单')),
          )
        }
        dispatchCatalogEvent(view.button('筛选歌单'), 'onClick', false)
        await nextTick()
        const openDimension = async (id: string) => {
          dispatchCatalogEvent(
            findCatalogElement(view.root, (node) => node.props['data-filter-dimension'] === id),
            'onClick',
            false,
          )
          await nextTick()
        }
        const choice = (value: string) =>
          findCatalogElement(
            view.root,
            (node) =>
              node.tag === 'input' &&
              (node.props.type === 'radio' || node.props.type === 'checkbox') &&
              node.props.value === value,
          )
        const choose = async (value: string) => {
          dispatchCatalogEvent(choice(value), 'onChange', false)
          await nextTick()
        }
        const confirmDimension = async () => {
          dispatchCatalogEvent(view.button('确定'), 'onClick', false)
          await nextTick()
        }
        await openDimension('cover')
        await choose('present')
        expect(view.root.textContent).toContain('匹配 1 / 3 个歌单')
        await confirmDimension()
        await openDimension('keyword')
        let keyword = findCatalogElement(
          view.root,
          (node) => node.props.placeholder === '输入歌单名称或简介',
        )
        ;(keyword.props['onUpdate:modelValue'] as (value: string) => void)('Mix')
        await nextTick()
        await view.replace()
        keyword = findCatalogElement(
          view.root,
          (node) => node.props.placeholder === '输入歌单名称或简介',
        )
        expect(keyword.value).toBe('Mix')
        expect(view.root.textContent).toContain('匹配 1 / 3 个歌单')
        expect(view.root.querySelectorAll('[data-collection-entry]')).toHaveLength(3)
        await confirmDimension()
        dispatchCatalogEvent(view.button('取消'), 'onClick', false)
        await nextTick()
        expect(view.root.querySelectorAll('[data-collection-entry]')).toHaveLength(3)
        dispatchCatalogEvent(view.button('筛选歌单'), 'onClick', false)
        await nextTick()
        await openDimension('cover')
        expect(choice('all').props.checked).toBe(true)
        dispatchCatalogEvent(view.button('返回筛选概览'), 'onClick', false)
        await nextTick()
        await openDimension('keyword')
        expect(
          findCatalogElement(view.root, (node) => node.props.placeholder === '输入歌单名称或简介')
            .value,
        ).toBe('')
        dispatchCatalogEvent(view.button('返回筛选概览'), 'onClick', false)
        await nextTick()
        const setCount = async (label: string, value: string) => {
          const input = findCatalogElement(view.root, (node) => node.props['aria-label'] === label)
          input.value = value
          input.dispatchListeners('input', { target: input })
          await nextTick()
        }
        await openDimension('trackCountRanges')
        await setCount('最多歌曲数量（首）', '1')
        expect(view.root.textContent).toContain('匹配 2 / 3 个歌单')
        dispatchCatalogEvent(view.button('返回筛选概览'), 'onClick', false)
        await nextTick()
        await openDimension('trackCountRanges')
        expect(
          findCatalogElement(view.root, (node) => node.props['aria-label'] === '最多歌曲数量（首）')
            .value,
        ).toBe('')
        await setCount('最多歌曲数量（首）', '1')
        await confirmDimension()
        dispatchCatalogEvent(view.button('清空全部'), 'onClick', false)
        view.confirmation.accept()
        await nextTick()
        await nextTick()
        expect(view.root.textContent).toContain('匹配 3 / 3 个歌单')
        await openDimension('trackCountRanges')
        await setCount('最少歌曲数量（首）', '1')
        await confirmDimension()
        dispatchCatalogEvent(view.button('应用筛选'), 'onClick', false)
        await nextTick()
        expect(view.root.textContent).not.toContain('Empty')
        const cover = findCatalogElement(
          view.root,
          (node) =>
            node.tag === 'button' && String(node.props['aria-label']).startsWith('打开歌单 Mix'),
        )
        const keyHandlers = cover.props.onKeydown as ((event: unknown) => void)[]
        keyHandlers.forEach((handler) =>
          handler({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} }),
        )
        expect(commands.reorderPlaylists).toHaveBeenCalledExactlyOnceWith(['q', 'empty', 'p'])
        dispatchCatalogEvent(view.button('操作器 已选 0'), 'onClick', false)
        await nextTick()
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.props['aria-label'] === '全选当前 2 个匹配歌单',
          ),
          'onChange',
          false,
        )
        await nextTick()
        dispatchCatalogEvent(view.button('加入待听'), 'onClick', false)
        expect(commands.enqueue).toHaveBeenCalledExactlyOnceWith(['one', 'two'])
        dispatchCatalogEvent(view.button('下载歌单歌曲'), 'onClick', false)
        view.confirmation.accept()
        await nextTick()
        expect(commands.download).toHaveBeenCalledExactlyOnceWith(['one', 'two'])
        dispatchCatalogEvent(view.button('删除已选歌单'), 'onClick', false)
        await view.replace()
        view.confirmation.accept()
        await nextTick()
        expect(commands.remove).not.toHaveBeenCalled()
        dispatchCatalogEvent(view.button('删除已选歌单'), 'onClick', false)
        view.confirmation.accept()
        await nextTick()
        await nextTick()
        expect(commands.remove).toHaveBeenCalledExactlyOnceWith(['p', 'q'])
      } finally {
        view.close()
      }
    },
  )

  it('shows bounded playlist labels in cover cards and retains the editor through its closing animation', async () => {
    const state = shallowReactive({
      ...list(),
      playlists: [
        {
          id: 'p',
          name: 'Mix',
          description: '仅详情显示的简介',
          trackIds: ['one'],
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ],
      activePlaylistId: null,
      query: '',
      nameDraft: '',
      coverUrls: {},
      transferBusy: false,
      playlistTagsAvailable: true,
      customTagsByPlaylistId: new Map([['p', ['通勤', '夜晚', '收藏']]]),
    })
    const commands = {
      ...actions(state),
      setNameDraft: (name: string) => {
        state.nameDraft = name
      },
      addPlaylistTag: vi.fn((id: string, tag: string) => {
        state.customTagsByPlaylistId = new Map([
          [id, [...state.customTagsByPlaylistId.get(id)!, tag]],
        ])
      }),
      removePlaylistTag: vi.fn(),
    }
    const view = mountRoot(definition.views.playlists, feature(state, commands))
    try {
      expect(view.root.textContent).not.toContain('仅详情显示的简介')
      expect(view.root.textContent).toContain('1 首歌曲')
      expect(view.root.textContent).not.toContain('+1')
      expect(view.root.textContent).toContain('收藏')
      dispatchCatalogEvent(view.button('查看 Mix 的详细信息'), 'onClick', false)
      await nextTick()
      expect(
        findCatalogElement(
          view.root,
          (node) => node.props.class === 'playlist-editor__summary-card',
        ).textContent,
      ).not.toContain('通勤')
      const tagDetails = view.button('查看全部歌单标签')
      expect(tagDetails.textContent).toContain('通勤夜晚收藏')
      dispatchCatalogEvent(tagDetails, 'onClick', false)
      await nextTick()
      const tagsDialog = findCatalogElement(
        view.root,
        (node) => node.tag === 'section' && node.props['aria-label'] === '歌单标签',
      )
      expect(tagsDialog.textContent).toContain('通勤夜晚收藏')
      dispatchCatalogEvent(tagsDialog, 'onClose', false)
      await nextTick()
      expect(tagDetails.props['aria-expanded']).toBe(false)
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['data-playlist-field'] === 'tags'),
        'onClick',
        false,
      )
      await nextTick()
      const input = findCatalogElement(view.root, (node) => node.props.name === 'playlist-tag')
      expect(
        view.button('返回歌单操作').parent?.children.filter((node) => node.tag === 'button'),
      ).toEqual([view.button('返回歌单操作')])
      ;(input.props['onUpdate:modelValue'] as (value: string) => void)(' 轻音乐 ')
      await nextTick()
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.tag === 'form'),
        'onSubmit',
        false,
      )
      expect(commands.addPlaylistTag).toHaveBeenCalledExactlyOnceWith('p', '轻音乐')
      await nextTick()
      expect(view.root.textContent).toContain('轻音乐')
      expect(input.value).toBe('')
      expect(view.button('添加').props.disabled).toBe(true)
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.tag === 'form'),
        'onSubmit',
        false,
      )
      expect(commands.addPlaylistTag).toHaveBeenCalledOnce()
      dispatchCatalogEvent(view.button('移除标签 通勤'), 'onClick', false)
      expect(commands.removePlaylistTag).toHaveBeenCalledExactlyOnceWith('p', '通勤')
      state.playlistTagsAvailable = false
      await nextTick()
      expect(view.button('添加').props.disabled).toBe(true)
      dialogLeave.manual = true
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === 'Mix'),
        'onClose',
        false,
      )
      await nextTick()
      const dialog = findCatalogElement(view.root, (node) => node.props['aria-label'] === 'Mix')
      expect(dialog.props['data-dialog-open']).toBe(false)
      expect(findCatalogElement(dialog, (node) => node.tag === 'fieldset').props.disabled).toBe(
        true,
      )
      dispatchCatalogEvent(dialog, 'onFinishLeave', false)
      await nextTick()
      expect(view.root.querySelectorAll('[aria-label="Mix"]')).toHaveLength(0)
    } finally {
      dialogLeave.manual = false
      view.close()
    }
  })

  it.each(['remove', 'replace'] as const)(
    'discards unsaved cover changes on return and only submits on save (%s)',
    async (operation) => {
      const replacement = 'data:image/jpeg;base64,NEW'
      if (operation === 'replace') {
        vi.stubGlobal('createImageBitmap', async () => ({
          width: 800,
          height: 500,
          close: vi.fn(),
        }))
        vi.stubGlobal('document', {
          createElement: () => ({
            getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn() }),
            toDataURL: () => replacement,
          }),
        })
      }
      const state = shallowReactive({
        ...list(),
        playlists: [
          {
            id: 'p',
            name: 'Mix',
            coverId: 'cover',
            trackIds: ['one'],
            createdAtMs: 1,
            updatedAtMs: 1,
          },
        ],
        activePlaylistId: null,
        query: '',
        nameDraft: '',
        coverUrls: { cover: 'data:image/jpeg;base64,AA==' },
      })
      const commands = {
        ...actions(state),
        open: vi.fn(),
        create: vi.fn(),
        saveDetails: vi.fn(),
        remove: vi.fn(),
        removeTracks: vi.fn(),
        reorderTracks: vi.fn(),
        renamePlaylist: vi.fn(),
        updateDescription: vi.fn(),
        reorderPlaylists: vi.fn(),
        setQuery: vi.fn(),
        setNameDraft: vi.fn((name: string) => {
          state.nameDraft = name
        }),
      }
      const view = mountRoot(definition.views.playlists, feature(state, commands))
      const editCover = async () => {
        dispatchCatalogEvent(
          findCatalogElement(view.root, (node) => node.props['data-playlist-field'] === 'cover'),
          'onClick',
          false,
        )
        await nextTick()
      }
      const changeCover = async () => {
        if (operation === 'remove') dispatchCatalogEvent(view.button('移除封面'), 'onClick', false)
        else {
          const input = findCatalogElement(
            view.root,
            (node) => node.props['aria-label'] === '上传歌单封面',
          )
          Object.assign(input, {
            files: [
              new File([new Uint8Array([255, 216, 255, 0])], 'cover.jpg', { type: 'image/jpeg' }),
            ],
          })
          dispatchCatalogEvent(input, 'onChange', false)
          await vi.waitFor(() => expect(view.button('使用此封面')).toBeTruthy())
          dispatchCatalogEvent(view.button('使用此封面'), 'onClick', false)
        }
        await nextTick()
      }
      try {
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) =>
              node.tag === 'button' && String(node.props['aria-label']).startsWith('打开歌单 Mix'),
          ),
          'onClick',
          false,
        )
        await nextTick()
        expect(commands.open).toHaveBeenCalledExactlyOnceWith('p')
        expect(view.root.querySelectorAll('[aria-label="Mix封面预览"]')).toHaveLength(0)
        dispatchCatalogEvent(view.button('查看 Mix 的详细信息'), 'onClick', false)
        await nextTick()
        await editCover()
        expect(view.button('保存').props.disabled).toBe(true)
        await changeCover()
        expect(view.button('保存').props.disabled).toBe(false)
        expect(commands.saveDetails).not.toHaveBeenCalled()
        dispatchCatalogEvent(view.button('返回歌单操作'), 'onClick', false)
        await nextTick()
        const summary = findCatalogElement(
          view.root,
          (node) => node.props.class === 'playlist-editor__summary-card',
        )
        expect(findCatalogElement(summary, (node) => node.tag === 'img').props.src).toBe(
          state.coverUrls.cover,
        )
        dispatchCatalogEvent(view.button('预览歌单封面'), 'onClick', false)
        await nextTick()
        expect(view.root.querySelectorAll('[aria-label="Mix封面预览"]')).toHaveLength(1)
        expect(view.root.textContent).toContain('100%')
        expect(commands.saveDetails).not.toHaveBeenCalled()
        dispatchCatalogEvent(
          findCatalogElement(view.root, (node) => node.props['aria-label'] === 'Mix封面预览'),
          'onClose',
          false,
        )
        await nextTick()
        await editCover()
        expect(view.button('保存').props.disabled).toBe(true)
        await changeCover()
        dispatchCatalogEvent(
          findCatalogElement(view.root, (node) => node.tag === 'form'),
          'onSubmit',
          false,
        )
        await nextTick()
        expect(commands.saveDetails).toHaveBeenCalledExactlyOnceWith(
          'p',
          'Mix',
          '',
          operation === 'remove' ? null : replacement,
        )
      } finally {
        view.close()
      }
    },
  )

  it('renders published assets with creation disabled and forwards their format and expansion', async () => {
    const record: LibraryTrackRecord = {
      track: {
        ...tracks[0]!,
        source: { pluginId: 'local-custom', resourceId: 'one', mediaKind: 'custom' },
      },
      customTags: [],
      addedAtMs: 1,
      updatedAtMs: 1,
    }
    const definitionData: CustomTrackDefinition = {
      version: 1,
      trackId: 'one',
      materialCollectionId: '',
      recipe: [{ sourceTrackId: 'two', startMs: 0, endMs: 1000 }],
      compiledSegments: [
        { sourceTrackId: 'two', startMs: 0, endMs: 1000, virtualStartMs: 0, virtualEndMs: 1000 },
      ],
      creator: { id: 'c', displayName: '创作者' },
      sourceCredits: [],
      createdAtMs: 1,
    }
    const state = shallowReactive({
      ...list(),
      records: [record],
      definitions: [definitionData],
      materialCollections: [],
      query: '',
      expandedTrackIds: [],
      exportFormat: 'wav' as const,
      exportBusy: false,
    })
    const commands = {
      ...actions(state),
      remove: vi.fn(),
      edit: vi.fn(),
      setQuery: vi.fn(),
      setExpanded: vi.fn(),
      setExportFormat: vi.fn(),
    }
    const view = mountRoot(definition.views['custom-tracks'], feature(state, commands))
    expect(view.root.textContent).toContain('创作者')
    expect(view.root.textContent).not.toContain('作为素材')
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) =>
          node.tag === 'button' && String(node.props.class).includes('custom-track-drawer__toggle'),
      ),
      'onClick',
      false,
    )
    expect(commands.setExpanded).toHaveBeenCalledExactlyOnceWith('one', true)
    dispatchCatalogEvent(view.button('下载'), 'onClick', false)
    expect(commands.download).toHaveBeenCalledExactlyOnceWith(['one'], 'wav')
    await view.replace()
    expect(commands.download).toHaveBeenCalledTimes(1)
    expect(commands.setQuery).not.toHaveBeenCalled()
    view.close()
  })

  it('keeps playback records selected across remount and sends only history actions', async () => {
    const state = shallowReactive({
      ...list(),
      entries: [
        {
          id: 'h',
          trackId: 'one',
          startedAtMs: 1,
          updatedAtMs: 1,
          positionMs: 10,
          completed: false,
        },
      ],
      tracks,
      platformNames: new Map(),
      customNamesByTrackId: new Map(),
      query: '',
      platformId: 'all',
      startedAfterMs: null,
    })
    const commands = {
      ...actions(state),
      toggleQueue: vi.fn(),
      setQuery: vi.fn((query: string) => {
        state.query = query
      }),
      setPlatform: vi.fn(),
      setStartedAfter: vi.fn(),
      play: vi.fn(),
      enqueue: vi.fn(),
      clear: vi.fn(),
    }
    const view = mountRoot(definition.views.history, feature(state, commands))
    dispatchCatalogEvent(view.button('打开《one》的操作'), 'onClick', false)
    await nextTick()
    dispatchCatalogEvent(view.button('添加待听'), 'onClick', false)
    expect(commands.toggleQueue).toHaveBeenCalledExactlyOnceWith('one')
    await nextTick()
    dispatchCatalogEvent(view.button('操作器 已选 0'), 'onClick', false)
    await nextTick()
    const checkbox = findCatalogElement(
      view.root,
      (node) => node.tag === 'input' && node.props['data-am-focus-key'] === 'track:h:select',
    )
    dispatchCatalogEvent(checkbox, 'onChange', false)
    await nextTick()
    dispatchCatalogEvent(view.button('播放已选'), 'onClick', false)
    expect(commands.play).toHaveBeenCalledExactlyOnceWith('one', ['one'])
    expect(view.root.textContent).toContain('清空历史')
    await view.replace()
    expect(view.root.textContent).toContain('播放已选')
    expect(commands.clear).not.toHaveBeenCalled()
    dispatchCatalogEvent(view.button('清空历史'), 'onClick', false)
    expect(view.confirmation.activeRequest.value?.title).toBe('清空播放历史')
    view.confirmation.cancel()
    await nextTick()
    expect(commands.clear).not.toHaveBeenCalled()
    dispatchCatalogEvent(view.button('清空历史'), 'onClick', false)
    view.confirmation.accept()
    await nextTick()
    expect(commands.clear).toHaveBeenCalledOnce()
    view.close()
  })

  it('keeps duplicate plays independent and confirms clearing from the song actions rail', async () => {
    const state = shallowReactive({
      ...list(),
      mobileLayout: true,
      entries: ['first', 'second'].map((id, index) => ({
        id,
        trackId: 'one',
        startedAtMs: index + 1,
        updatedAtMs: index + 1,
        positionMs: index * 1000,
        completed: false,
      })),
      query: '',
      platformId: 'all',
      startedAfterMs: null,
    })
    const commands = {
      ...actions(state),
      toggleQueue: vi.fn(),
      clear: vi.fn(),
      setQuery: vi.fn(),
      setPlatform: vi.fn(),
      setStartedAfter: vi.fn(),
    }
    const view = mountRoot(definition.views.history, feature(state, commands))
    try {
      expect(view.button('歌曲展示方式').textContent).not.toContain('展示')
      dispatchCatalogEvent(view.button('操作器 已选 0'), 'onClick', false)
      await nextTick()
      const select = (id: string) =>
        findCatalogElement(
          view.root,
          (node) => node.props['data-am-focus-key'] === `track:${id}:select`,
        )
      dispatchCatalogEvent(select('first'), 'onChange', false)
      await nextTick()
      expect(select('first').props.checked).toBe(true)
      expect(select('second').props.checked).toBe(false)
      dispatchCatalogEvent(view.button('按平台'), 'onClick', false)
      await nextTick()
      expect(view.root.textContent).toContain('2 条播放记录')
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['data-collection-entry'] === 'source'),
        'onClick',
        false,
      )
      await nextTick()
      expect(view.root.textContent).toContain('播放历史 · 共 2 条')
      expect(select('first').props.checked).toBe(true)
      expect(select('second').props.checked).toBe(false)
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.props['data-am-focus-key'] === 'track:second:actions',
        ),
        'onClick',
        false,
      )
      await nextTick()
      const dialog = findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '歌曲操作',
      )
      const primary = findCatalogElement(
        dialog,
        (node) => node.props['aria-label'] === '歌曲常用操作',
      )
      expect(primary.textContent).toContain('播放待听喜欢下载清空历史')
      expect(dialog.textContent).toContain('播放于')
      const clear = findCatalogElement(
        primary,
        (node) => node.tag === 'button' && node.textContent === '清空历史',
      )
      dispatchCatalogEvent(clear, 'onClick', false)
      expect(commands.clear).not.toHaveBeenCalled()
      expect(view.confirmation.activeRequest.value?.title).toBe('清空播放历史')
      view.confirmation.cancel()
      await nextTick()
      expect(commands.clear).not.toHaveBeenCalled()
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.props['data-am-focus-key'] === 'track:second:actions',
        ),
        'onClick',
        false,
      )
      await nextTick()
      const reopened = findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '歌曲操作',
      )
      dispatchCatalogEvent(
        findCatalogElement(
          reopened,
          (node) => node.tag === 'button' && node.textContent === '清空历史',
        ),
        'onClick',
        false,
      )
      view.confirmation.accept()
      await nextTick()
      expect(commands.clear).toHaveBeenCalledOnce()
    } finally {
      view.close()
    }
  })

  it('ignores a pending history clear when the initiating presentation is replaced', async () => {
    const state = shallowReactive({
      ...list(),
      entries: [
        {
          id: 'play',
          trackId: 'one',
          startedAtMs: 1,
          updatedAtMs: 1,
          positionMs: 0,
          completed: false,
        },
      ],
      query: '',
      platformId: 'all',
      startedAfterMs: null,
    })
    const commands = {
      ...actions(state),
      toggleQueue: vi.fn(),
      clear: vi.fn(),
      setQuery: vi.fn(),
      setPlatform: vi.fn(),
      setStartedAfter: vi.fn(),
    }
    const view = mountRoot(definition.views.history, feature(state, commands))
    try {
      dispatchCatalogEvent(view.button('打开《one》的操作'), 'onClick', false)
      await nextTick()
      dispatchCatalogEvent(view.button('清空历史'), 'onClick', false)
      await view.replace()
      view.confirmation.accept()
      await nextTick()
      expect(commands.clear).not.toHaveBeenCalled()
    } finally {
      view.close()
    }
  })

  it('uses task IDs across partial downloads and exposes unavailable native saving without dispatching work', async () => {
    const batch: DownloadHistoryBatch = {
      id: 'batch',
      status: 'running',
      startedAtMs: 1,
      concurrency: 1,
      origin: { kind: 'queue', label: '待听' },
      items: [
        {
          id: 'active-task',
          track: tracks[0]!,
          status: 'downloading',
          requestedAtMs: 1,
          maxRetryCount: 3,
          attempts: [],
          progressMessage: '42%',
        },
        {
          id: 'paused-task',
          track: tracks[1]!,
          status: 'paused',
          requestedAtMs: 1,
          maxRetryCount: 3,
          attempts: [],
        },
      ],
    }
    const state = shallowReactive({
      ...list(),
      batches: [
        batch,
        {
          ...batch,
          id: 'older',
          status: 'completed',
          items: [{ ...batch.items[0]!, id: 'older-task', status: 'succeeded', savedAtMs: 1 }],
        },
      ],
      selectedItemIds: ['active-task', 'paused-task', 'older-task'],
      concurrency: 1,
      statusFilter: 'all' as const,
    })
    const commands = {
      ...actions(state),
      select: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      remove: vi.fn(),
      retry: vi.fn(),
      setStatusFilter: vi.fn(),
      moveItem: vi.fn(),
    }
    const model = feature(state, commands)
    const view = mountRoot(definition.views.downloads, model)
    dispatchCatalogEvent(view.button('操作器 已选 ' + 2), 'onClick', false)
    await nextTick()
    expect(view.root.textContent).toContain('42%')
    expect(view.root.textContent).toContain('已选 2')
    expect(Boolean(view.button('重试已选').props.disabled)).toBe(true)
    dispatchCatalogEvent(view.button('暂停下载'), 'onClick', false)
    expect(commands.pause).toHaveBeenCalledExactlyOnceWith(['active-task'])
    dispatchCatalogEvent(view.button('继续已选'), 'onClick', false)
    expect(commands.resume).toHaveBeenCalledExactlyOnceWith(['paused-task'])
    dispatchCatalogEvent(view.button('取消下载'), 'onClick', false)
    expect(commands.cancel).toHaveBeenCalledExactlyOnceWith(['active-task'])
    dispatchCatalogEvent(view.button('移除记录'), 'onClick', false)
    await view.replace()
    view.confirmation.accept()
    await nextTick()
    expect(commands.remove).not.toHaveBeenCalled()
    model.availability = { status: 'unavailable', reason: '当前运行端不支持原生保存。' }
    await nextTick()
    expect(view.root.textContent).toContain('当前运行端不支持原生保存。')
    expect(view.button('筛选歌曲').props.disabled).toBe(true)
    expect(commands.resume).toHaveBeenCalledTimes(1)
    view.close()
  })
})
