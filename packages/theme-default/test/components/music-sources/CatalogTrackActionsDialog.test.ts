import type { Track } from '@any-music/core'
import {
  provideTrackNames,
  provideTrackAccountName,
  UI_CONTRIBUTIONS,
  provideConfirmationDialog,
} from '@any-music/ui'
import type { UiContributionHost } from '@any-music/ui'
import TrackCardSummary from '@any-music/ui/components/tracks/TrackCardSummary.vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, reactive, shallowRef } from 'vue'

import CatalogTrackActionsDialog from '../../../src/components/music-sources/CatalogTrackActionsDialog.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

beforeEach(() => vi.stubGlobal('Document', CatalogTestElement))
afterEach(() => vi.unstubAllGlobals())

function visibleText(node: CatalogTestElement): string {
  return node.tag === '#comment' ? '' : node.text + node.children.map(visibleText).join('')
}

vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})
vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title', 'suspended'],
      emits: ['close'],
      inheritAttrs: false,
      setup:
        (props, { slots, emit }) =>
        () =>
          props.open
            ? vue.h(
                'section',
                {
                  role: 'dialog',
                  'aria-label': props.title,
                  'aria-hidden': props.suspended ? 'true' : undefined,
                },
                [
                  vue.h('button', {
                    type: 'button',
                    'aria-label': `关闭${props.title}`,
                    onClick: () => emit('close'),
                  }),
                  slots.default?.(),
                ],
              )
            : null,
    }),
  }
})
function createTrack(id: string): Track {
  return {
    id,
    title: '来源原名',
    artists: [{ name: '作者' }],
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: id },
  }
}

describe('shared track naming', () => {
  it('offers playlist selection below naming and adds one song to multiple checked playlists', async () => {
    const track = createTrack('one')
    const addToPlaylist = vi.fn()
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          provideConfirmationDialog()
          return () =>
            h(CatalogTrackActionsDialog, {
              open: true,
              track,
              customTags: [],
              invalid: false,
              favorite: false,
              playlists: ['a', 'b'].map((id) => ({
                id,
                name: id,
                trackIds: [],
                createdAtMs: 1,
                updatedAtMs: 1,
              })),
              onAddToPlaylist: addToPlaylist,
            })
        },
      }),
      {},
    )
    const button = (label: string) =>
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent.includes(label),
      )
    expect(view.root.textContent.indexOf('添加歌单')).toBeGreaterThan(
      view.root.textContent.indexOf('自定义名称'),
    )
    dispatchCatalogEvent(button('添加歌单'), 'onClick')
    await nextTick()
    const all = () =>
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '全选当前歌单')
    expect(all().props['aria-pressed']).toBe(false)
    dispatchCatalogEvent(all(), 'onClick')
    await nextTick()
    expect(all().props['aria-pressed']).toBe(true)
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '选择歌单 a'),
      'onChange',
    )
    await nextTick()
    expect(all().props['aria-pressed']).toBe(false)
    dispatchCatalogEvent(all(), 'onClick')
    await nextTick()
    dispatchCatalogEvent(button('加入歌单（2）'), 'onClick')
    await nextTick()
    expect(addToPlaylist.mock.calls.map(([, id]) => id).toSorted()).toEqual(['a', 'b'])
    expect(addToPlaylist.mock.calls.every(([song]) => song.id === 'one')).toBe(true)
    dispatchCatalogEvent(button('添加歌单'), 'onClick')
    await nextTick()
    expect(all().props['aria-pressed']).toBe(false)
    expect(button('加入歌单（0）').props.disabled).toBe(true)
    view.unmount()
  })

  it('offers all existing user tags for an untagged song and updates additions and removals immediately', async () => {
    const props = reactive({
      open: true,
      track: { ...createTrack('one'), sourceTags: ['来源标签'] },
      customTags: [] as string[],
      invalid: false,
      favorite: false,
      suspended: false,
    })
    const names = shallowRef(['通勤', '未使用标签'])
    const enabled = shallowRef(true)
    const resolve = vi.fn<UiContributionHost['resolve']>((point) =>
      point === 'track.actions.secondary' && enabled.value
        ? [
            {
              id: 'feature.tags/manage-tags',
              implementationId: 'manage-tags',
              revision: 1,
              viewRevision: 1,
              contextKey: 'song',
              inputOptions: names.value.map((value) => ({
                value,
                selected: props.customTags.includes(value),
              })),
            },
          ]
        : [],
    )
    const addTag = vi.fn((_track: Track, tag: string) => {
      props.customTags = [...props.customTags, tag]
    })
    const removeTag = vi.fn((_track: Track, tag: string) => {
      props.customTags = props.customTags.filter((name) => name !== tag)
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          provide(UI_CONTRIBUTIONS, { resolve, accepts: () => enabled.value })
          return () =>
            h(CatalogTrackActionsDialog, { ...props, onAddTag: addTag, onRemoveTag: removeTag })
        },
      }),
      {},
    )
    const choice = (label: string) =>
      findCatalogElement(view.root, (node) => node.props['aria-label'] === label)
    const openTags = async () => {
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent.includes('管理标签'),
        ),
        'onClick',
      )
      await nextTick()
    }
    try {
      await openTags()
      expect(resolve).toHaveBeenCalledWith(
        'track.actions.secondary',
        expect.objectContaining({ selectedTracks: [props.track] }),
      )
      expect(choice('添加标签 通勤').props['aria-pressed']).toBe(false)
      expect(choice('添加标签 未使用标签')).toBeDefined()
      expect(visibleText(view.root)).not.toContain('还没有标签')
      expect(visibleText(view.root)).not.toContain('来源标签')
      dispatchCatalogEvent(choice('添加标签 通勤'), 'onClick')
      await nextTick()
      expect(addTag).toHaveBeenCalledExactlyOnceWith(props.track, '通勤')
      expect(choice('移除标签 通勤').props['aria-pressed']).toBe(true)
      dispatchCatalogEvent(choice('移除标签 通勤'), 'onClick')
      await nextTick()
      expect(removeTag).toHaveBeenCalledExactlyOnceWith(props.track, '通勤')
      expect(choice('添加标签 通勤').props['aria-pressed']).toBe(false)
      names.value = [...names.value, '新建标签']
      await nextTick()
      expect(choice('添加标签 新建标签')).toBeDefined()
      props.track = { ...createTrack('two'), sourceTags: [] }
      await nextTick()
      await openTags()
      expect(
        resolve.mock.calls.findLast(([point]) => point === 'track.actions.secondary')?.[1],
      ).toEqual(expect.objectContaining({ selectedTracks: [props.track] }))
      const staleChoice = choice('添加标签 未使用标签')
      props.suspended = true
      await nextTick()
      dispatchCatalogEvent(staleChoice, 'onClick', false)
      expect(addTag).toHaveBeenCalledOnce()
      props.suspended = false
      enabled.value = false
      dispatchCatalogEvent(staleChoice, 'onClick', false)
      await nextTick()
      expect(addTag).toHaveBeenCalledOnce()
      expect(() => choice('添加标签 未使用标签')).toThrow()
    } finally {
      view.unmount()
    }
  })

  it('previews all tags without editing and resets the preview when the song changes or closes', async () => {
    const props = reactive({
      open: true,
      track: createTrack('one'),
      customTags: ['通勤', '纯音乐', '适合安静阅读的长标签'],
      invalid: false,
      favorite: false,
      suspended: false,
      onAddTag: vi.fn(),
      onRemoveTag: vi.fn(),
    })
    const view = mountCatalogComponent(CatalogTrackActionsDialog, props)
    const preview = () =>
      findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '歌曲标签' && node.props.role === 'dialog',
      )
    const trigger = () =>
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '查看全部标签')
    try {
      expect(preview).toThrow()
      dispatchCatalogEvent(trigger(), 'onClick')
      await nextTick()
      const dialog = preview()
      expect(dialog.querySelectorAll('[role="listitem"]').map((node) => node.textContent)).toEqual(
        props.customTags,
      )
      expect(dialog.querySelector('[name="catalog-track-tag"]')).toBeNull()
      expect(dialog.querySelectorAll('[type="button"]')).toHaveLength(1)
      expect(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === '歌曲操作').props[
          'aria-hidden'
        ],
      ).toBe('true')
      dispatchCatalogEvent(dialog.querySelectorAll('[role="listitem"]')[0]!, 'onClick')
      expect(props.onAddTag).not.toHaveBeenCalled()
      expect(props.onRemoveTag).not.toHaveBeenCalled()
      dispatchCatalogEvent(
        findCatalogElement(dialog, (node) => node.props['aria-label'] === '关闭歌曲标签'),
        'onClick',
      )
      await nextTick()
      expect(preview).toThrow()
      expect(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === '歌曲操作').props[
          'aria-hidden'
        ],
      ).toBeUndefined()
      dispatchCatalogEvent(trigger(), 'onClick')
      await nextTick()
      props.track = createTrack('two')
      await nextTick()
      expect(preview).toThrow()
      dispatchCatalogEvent(trigger(), 'onClick')
      await nextTick()
      props.open = false
      await nextTick()
      props.open = true
      await nextTick()
      expect(preview).toThrow()
      props.customTags = []
      await nextTick()
      expect(trigger).toThrow()
    } finally {
      view.unmount()
    }
  })

  it('pages overflowing primary actions with the operator arrow and returns to the first actions', async () => {
    let resize!: () => void
    vi.stubGlobal('HTMLElement', CatalogTestElement)
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback
        }
        observe() {}
        disconnect() {}
      },
    )
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () =>
          h(
            CatalogTrackActionsDialog,
            {
              open: true,
              track: createTrack('one'),
              customTags: [],
              invalid: false,
              favorite: false,
              scrollPrimaryActions: true,
            },
            { 'primary-action': () => h('button', { type: 'button' }, '清空历史') },
          ),
      }),
      {},
    )
    try {
      const primary = findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '歌曲常用操作',
      )
      const viewport = findCatalogElement(primary, (node) =>
        String(node.props.class).includes('catalog-operator-actions__viewport'),
      )
      const content = findCatalogElement(primary, (node) =>
        String(node.props.class).includes('catalog-operator-actions__content'),
      )
      Object.assign(primary, { clientWidth: 320 })
      const scrollTo = vi.fn((options: ScrollToOptions) => {
        viewport.scrollLeft = Math.min(128, options.left ?? 0)
      })
      Object.assign(viewport, { clientWidth: 272, scrollWidth: 400, scrollTo })
      Object.assign(content, { scrollWidth: 400 })
      content.children
        .filter((node) => node.tag === 'button')
        .forEach((node, index) => Object.assign(node, { offsetLeft: index * 80, offsetWidth: 80 }))
      resize()
      await nextTick()
      dispatchCatalogEvent(
        findCatalogElement(primary, (node) => node.props['aria-label'] === '查看更多操作'),
        'onClick',
        false,
      )
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 240, behavior: 'instant' })
      dispatchCatalogEvent(viewport, 'onScroll', false)
      await nextTick()
      dispatchCatalogEvent(
        findCatalogElement(primary, (node) => node.props['aria-label'] === '返回前面的操作'),
        'onClick',
        false,
      )
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'instant' })
    } finally {
      view.unmount()
    }
  })
  it('omits acquisition account details while preserving the saved acquisition snapshot', async () => {
    const track = createTrack('one')
    track.acquisition = { accountId: 'original', accountName: '添加时名称', acquiredAtMs: 1 }
    const name = shallowRef('当前名称')
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          provideTrackAccountName(() => name.value)
          return () =>
            h(CatalogTrackActionsDialog, {
              open: true,
              track,
              customTags: [],
              invalid: false,
              favorite: false,
            })
        },
      }),
      {},
    )
    expect(visibleText(view.root)).not.toContain('添加账号')
    expect(visibleText(view.root)).not.toContain('当前名称')
    expect(visibleText(view.root)).not.toContain('添加时名称')
    name.value = '重新添加名称'
    await nextTick()
    expect(visibleText(view.root)).not.toContain('添加账号')
    expect(visibleText(view.root)).not.toContain('重新添加名称')
    expect(track.acquisition.accountName).toBe('添加时名称')
    view.unmount()
  })
  it('keeps favorite and queue cancellation available for saved invalid tracks and guards downloads', async () => {
    const props = reactive({
      open: true,
      track: createTrack('one'),
      customTags: [],
      invalid: true,
      favorite: true,
      queued: true,
      downloadBusy: true,
      suspended: false,
    })
    const onFavorite = vi.fn()
    const onQueue = vi.fn()
    const onDownload = vi.fn()
    const view = mountCatalogComponent(CatalogTrackActionsDialog, {
      ...props,
      onFavorite,
      onQueue,
      onDownload,
    })
    const favorite = findCatalogElement(
      view.root,
      (node) => node.props['aria-label'] === '取消喜欢',
    )
    const queue = findCatalogElement(view.root, (node) => node.props['aria-label'] === '取消待听')
    expect(favorite.props.disabled).toBe(false)
    expect(queue.props.disabled).toBe(false)
    expect(queue.textContent).toContain('已待听')
    dispatchCatalogEvent(favorite, 'onClick')
    dispatchCatalogEvent(queue, 'onClick')
    expect(onFavorite).toHaveBeenCalledExactlyOnceWith(props.track)
    expect(onQueue).toHaveBeenCalledExactlyOnceWith(props.track)
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent.includes('下载'),
      ),
      'onClick',
    )
    expect(onDownload).not.toHaveBeenCalled()
    view.unmount()
  })
  it('updates every copy of the same track immediately and leaves other IDs independent', async () => {
    const names = shallowRef<ReadonlyMap<string, string>>(new Map())
    const host = defineComponent({
      setup() {
        provideTrackNames(names)
        return () =>
          h('main', [
            h(TrackCardSummary, { track: createTrack('one') }),
            h(TrackCardSummary, { track: createTrack('one') }),
            h(TrackCardSummary, { track: createTrack('two') }),
          ])
      },
    })
    const view = mountCatalogComponent(host, {})
    const titles = () =>
      view.root.children[0]!.children.map((card) =>
        visibleText(findCatalogElement(card, (node) => node.tag === 'h3')).trim(),
      )
    expect(titles()).toEqual(['来源原名', '来源原名', '来源原名'])
    names.value = new Map([['one', '<通勤>']])
    await nextTick()
    expect(titles()).toEqual(['<通勤>', '<通勤>', '来源原名'])
    expect(visibleText(view.root).match(/原名\s*来源原名/g)).toHaveLength(2)
    names.value = new Map()
    await nextTick()
    expect(titles()).toEqual(['来源原名', '来源原名', '来源原名'])
    expect(visibleText(view.root)).not.toMatch(/原名\s*来源原名/)
    view.unmount()
  })

  it('saves normalized names, returns without saving, restores with an empty name and resets on track changes', async () => {
    const track = shallowRef(createTrack('one'))
    const names = shallowRef<ReadonlyMap<string, string>>(new Map())
    const rename = vi.fn((selected: Track, name: string) => {
      names.value = name ? new Map([[selected.id, name]]) : new Map()
    })
    const host = defineComponent({
      setup() {
        provideTrackNames(names)
        return () =>
          h(CatalogTrackActionsDialog, {
            open: true,
            track: track.value,
            customTags: [],
            favorite: false,
            invalid: false,
            onRename: rename,
          })
      },
    })
    const view = mountCatalogComponent(host, {})
    const button = (text: string) =>
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent.includes(text),
      )
    dispatchCatalogEvent(button('自定义名称'), 'onClick')
    await nextTick()
    const input = findCatalogElement(view.root, (node) => node.props.name === 'track-custom-name')
    ;(input.props['onUpdate:modelValue'] as (value: string) => void)('  Ａ  通勤  ')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
    )
    await nextTick()
    expect(rename).toHaveBeenLastCalledWith(track.value, 'A 通勤')
    expect(visibleText(findCatalogElement(view.root, (node) => node.tag === 'h3')).trim()).toBe(
      'A 通勤',
    )
    expect(visibleText(view.root)).toMatch(/原名\s*来源原名/)
    dispatchCatalogEvent(button('自定义名称'), 'onClick')
    await nextTick()
    const editor = findCatalogElement(view.root, (node) => node.tag === 'form')
    expect(
      editor
        .querySelectorAll('[type="button"], [type="submit"]')
        .map((node) => node.textContent.trim()),
    ).toEqual(['返回', '保存名称'])
    expect(() => button('恢复原名')).toThrow()
    expect(visibleText(view.root)).not.toContain('返回歌曲操作')
    const nameInput = () =>
      findCatalogElement(view.root, (node) => node.props.name === 'track-custom-name')
    ;(nameInput().props['onUpdate:modelValue'] as (value: string) => void)('未保存的名称')
    await nextTick()
    dispatchCatalogEvent(button('返回'), 'onClick')
    await nextTick()
    expect(rename).toHaveBeenCalledTimes(1)
    expect(visibleText(view.root)).not.toContain('保存名称')
    dispatchCatalogEvent(button('自定义名称'), 'onClick')
    await nextTick()
    expect(nameInput().value).toBe('A 通勤')
    ;(nameInput().props['onUpdate:modelValue'] as (value: string) => void)('')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
    )
    await nextTick()
    expect(rename).toHaveBeenLastCalledWith(track.value, '')
    expect(visibleText(findCatalogElement(view.root, (node) => node.tag === 'h3')).trim()).toBe(
      '来源原名',
    )
    dispatchCatalogEvent(button('自定义名称'), 'onClick')
    await nextTick()
    track.value = createTrack('two')
    await nextTick()
    await nextTick()
    expect(view.root.textContent).not.toContain('保存名称')
    expect(rename).toHaveBeenCalledTimes(2)
    view.unmount()
  })
})
