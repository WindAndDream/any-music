import type { MusicPlaylist } from '@any-music/core'
import {
  createEditingSession,
  provideEditingSession,
  provideConfirmationDialog,
  createPlaylistOverviewFilters,
  filterPlaylistOverview,
} from '@any-music/ui/library'
import type { PlaylistOverviewFilters as Filters } from '@any-music/ui/library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import PlaylistOverviewFilters from '../../../src/components/library/PlaylistOverviewFilters.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
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
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? vue.h('section', [slots.default?.(), slots.footer?.()]) : null,
    }),
  }
})
beforeEach(() => {
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('ShadowRoot', CatalogTestElement)
})
afterEach(() => vi.unstubAllGlobals())

function mountFilters() {
  const playlists: MusicPlaylist[] = [
    {
      id: 'a',
      name: '夏日',
      description: '海边',
      coverId: 'cover',
      trackIds: ['1', '2'],
      createdAtMs: 1,
      updatedAtMs: 1,
    },
    { id: 'b', name: '通勤', trackIds: ['3'], createdAtMs: 1, updatedAtMs: 1 },
    { id: 'c', name: '空歌单', trackIds: [], createdAtMs: 1, updatedAtMs: 1 },
  ]
  const tags = new Map([
    ['a', ['放松', '夏日']],
    ['b', ['通勤', '夏日']],
  ])
  const draft = shallowRef<Filters | null>(createPlaylistOverviewFilters())
  const apply = vi.fn()
  const editing = createEditingSession()
  const host = defineComponent({
    setup() {
      provideEditingSession(editing)
      provideConfirmationDialog()
      return () =>
        h(PlaylistOverviewFilters, {
          draft: draft.value,
          playlists,
          customTagsByPlaylistId: tags,
          resultCount: filterPlaylistOverview(
            playlists,
            draft.value ?? createPlaylistOverviewFilters(),
            tags,
          ).length,
          totalCount: playlists.length,
          disabled: false,
          'onUpdate:draft': (value: Filters | null) => {
            draft.value = value
          },
          onApply: () => apply(draft.value),
        })
    },
  })
  const view = mountCatalogComponent(host, {})
  const button = (label: string) =>
    findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.textContent.trim() === label,
    )
  const click = async (label: string) => {
    dispatchCatalogEvent(button(label), 'onClick', false)
    await nextTick()
  }
  const open = async (dimension: string) => {
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['data-filter-dimension'] === dimension),
      'onClick',
      false,
    )
    await nextTick()
  }
  const input = async (label: string, value: string) => {
    const element = findCatalogElement(
      view.root,
      (node) =>
        node.tag === 'input' &&
        (node.props['aria-label'] === label || node.props.placeholder === label),
    )
    element.value = value
    element.dispatchListeners('input', { target: element })
    await nextTick()
  }
  return {
    ...view,
    draft,
    apply,
    click,
    open,
    input,
    dispose: () => {
      view.unmount()
      editing.dispose()
    },
  }
}

describe('playlist overview filter interactions', () => {
  it.each(['keyword', 'trackCountRanges', 'tags'])(
    'focuses the %s input on entry before the transition completes',
    async (dimension) => {
      const view = mountFilters()
      try {
        await view.open(dimension)
        expect(
          findCatalogElement(view.root, (node) => node.tag === 'input' && node.isFocused).props[
            'data-editor-focus'
          ],
        ).toBe('')
      } finally {
        view.dispose()
      }
    },
  )

  it('multiselects cover states, removes individual conditions and keeps All exclusive', async () => {
    const view = mountFilters()
    const all = () =>
      findCatalogElement(view.root, (node) => node.tag === 'input' && node.props.type === 'radio')
    const option = (value: string) =>
      findCatalogElement(view.root, (node) => node.tag === 'input' && node.props.value === value)
    const toggle = async (value?: string) => {
      dispatchCatalogEvent(value ? option(value) : all(), 'onChange', false)
      await nextTick()
    }
    try {
      await view.open('cover')
      expect(all().props.checked).toBe(true)
      expect(option('present').props.type).toBe('checkbox')
      expect(option('missing').props.type).toBe('checkbox')
      await toggle('present')
      expect(all().props.checked).toBe(false)
      expect(view.root.textContent).toContain('匹配 1 / 3 个歌单')
      expect(view.draft.value?.cover).toEqual([])
      await toggle('missing')
      expect(option('present').props.checked).toBe(true)
      expect(option('missing').props.checked).toBe(true)
      expect(view.root.textContent).toContain('匹配 3 / 3 个歌单')
      await view.click('确定')
      expect(view.draft.value?.cover).toEqual(['present', 'missing'])
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.props['aria-label'] === '删除歌单封面条件 已设置封面',
        ),
        'onClick',
        false,
      )
      await nextTick()
      expect(view.draft.value?.cover).toEqual(['missing'])
      await view.open('cover')
      await toggle('present')
      await view.click('返回')
      expect(view.draft.value?.cover).toEqual(['missing'])
      await view.open('cover')
      expect(option('present').props.checked).toBe(false)
      expect(option('missing').props.checked).toBe(true)
      await toggle()
      expect(option('missing').props.checked).toBe(false)
      expect(all().props.checked).toBe(true)
      await toggle('present')
      await toggle('present')
      expect(all().props.checked).toBe(true)
      await view.click('确定')
      expect(view.draft.value?.cover).toEqual([])
    } finally {
      view.dispose()
    }
  })

  it('uses text search styling and keeps dimension changes isolated until Confirm', async () => {
    const view = mountFilters()
    expect(view.root.textContent).toContain('文本搜索')
    expect(view.root.textContent).not.toContain('关键词')
    await view.open('keyword')
    const search = findCatalogElement(
      view.root,
      (node) => node.tag === 'input' && node.props.type === 'search',
    )
    expect(search.props.class).toContain('catalog-filter-editor__search-input')
    await view.input('输入歌单名称或简介', '海边')
    expect(view.root.textContent).toContain('匹配 1 / 3 个歌单')
    expect(view.draft.value?.keyword).toBe('')
    await view.click('返回')
    await view.open('keyword')
    expect(findCatalogElement(view.root, (node) => node.tag === 'input').value).toBe('')
    await view.input('输入歌单名称或简介', '海边')
    await view.click('确定')
    expect(view.draft.value?.keyword).toBe('海边')
    await view.click('应用筛选')
    expect(view.apply).toHaveBeenCalledWith(expect.objectContaining({ keyword: '海边' }))
    view.dispose()
  })

  it.each(['0', '-1', '1.5'])(
    'rejects count %s and commits a valid pending range from Confirm',
    async (invalid) => {
      const view = mountFilters()
      await view.open('trackCountRanges')
      const minimum = findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '最少歌曲数量（首）',
      )
      expect(minimum.props.inputmode).toBe('numeric')
      expect(minimum.props.class).toContain('catalog-filter-editor__line-input')
      await view.input('最少歌曲数量（首）', invalid)
      expect(view.root.textContent).toContain('请输入有效的正整数。')
      await view.click('确定')
      expect(view.root.textContent).toContain('已选歌曲数量')
      expect(view.draft.value?.trackCountRanges).toEqual([])
      await view.input('最少歌曲数量（首）', '2')
      await view.input('最多歌曲数量（首）', '1')
      expect(view.root.textContent).toContain('不能小于')
      await view.input('最多歌曲数量（首）', '2')
      expect(view.root.textContent).toContain('匹配 1 / 3 个歌单')
      await view.click('确定')
      expect(view.draft.value?.trackCountRanges).toEqual([{ minCount: 2, maxCount: 2 }])
      view.dispose()
    },
  )

  it('searches playlist tags, counts playlists and removes individual selected tags', async () => {
    const view = mountFilters()
    await view.open('tags')
    expect(view.root.textContent).toContain('夏日2 个歌单')
    await view.input('输入标签名称', '放松')
    expect(view.root.textContent).not.toContain('通勤1 个歌单')
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.tag === 'input' && node.props.type === 'checkbox',
      ),
      'onChange',
      false,
    )
    await nextTick()
    expect(view.root.textContent).toContain('匹配 1 / 3 个歌单')
    await view.click('确定')
    expect(view.draft.value?.tags).toEqual(['放松'])
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '删除用户标签条件 放松'),
      'onClick',
      false,
    )
    await nextTick()
    expect(view.draft.value?.tags).toEqual([])
    view.dispose()
  })
})
