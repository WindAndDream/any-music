import type { LibraryTrackRecord } from '@any-music/core'
import { createSession, Panel } from '@any-music/plugin-tag-management/vue'
import { definition as classic } from '@any-music/theme-default/vue'
import { definition as studio } from '@any-music/theme-studio/vue'
import { provideActionFeedback, provideConfirmationDialog } from '@any-music/ui'
import type { ConfirmationDialogController, TrackDisplayPreferences } from '@any-music/ui'
import type { TagManagementPresentation, UiThemeFeatureMap } from '@any-music/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, markRaw, nextTick, shallowRef } from 'vue'

import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  renderer,
} from '../../helpers/test-renderer'

// Exercise real feature controls and persistence; only the DOM overlay frame is substituted.
vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup(_, { slots, attrs }) {
        let previousKey: unknown
        return () => {
          const children = slots.default?.()
          const key = children?.[0]?.key
          if (previousKey !== undefined && key !== previousKey)
            (attrs.onAfterLeave as (() => void) | undefined)?.()
          previousKey = key
          return children
        }
      },
    }),
  }
})
vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const { defineComponent: defineOverlay, h: renderOverlay } = await import('vue')
  return {
    default: defineOverlay({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? renderOverlay('section', [slots.default?.(), slots.footer?.()]) : null,
    }),
  }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const { defineComponent: defineOverlay, h: renderOverlay } = await import('vue')
  return {
    default: defineOverlay({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? renderOverlay('section', [slots.default?.(), slots.footer?.()]) : null,
    }),
  }
})
vi.mock('@any-music/ui/components/SidePanel.vue', async () => {
  const { defineComponent: defineOverlay, h: renderOverlay } = await import('vue')
  return {
    default: defineOverlay({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? renderOverlay('aside', slots.default?.()) : null,
    }),
  }
})

const cleanup: (() => void)[] = []
function descendants(node: CatalogTestElement, tag: string): CatalogTestElement[] {
  return node.children.flatMap((child) => [
    ...(child.tag === tag ? [child] : []),
    ...descendants(child, tag),
  ])
}
beforeEach(() => {
  for (const name of [
    'Document',
    'Element',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'ShadowRoot',
  ])
    vi.stubGlobal(name, CatalogTestElement)
})
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose())
  vi.unstubAllGlobals()
})

function mount(
  initial: typeof classic | typeof studio,
  mobileLayout = false,
  secondPlatform = 'bilibili',
  initialSnapshot?: unknown,
) {
  const theme = shallowRef(initial)
  const defaultTrackDisplayPreferences = shallowRef<TrackDisplayPreferences>()
  const revision = shallowRef(0)
  const tracks: LibraryTrackRecord[] = ['一', '二'].map((id) => ({
    track: {
      id,
      title: `歌曲${id}`,
      artists: [],
      source: {
        pluginId: id === '二' ? secondPlatform : 'bilibili',
        resourceId: id,
        mediaKind: 'audio',
      },
    },
    customTags: [],
    addedAtMs: 1,
    updatedAtMs: 1,
  }))
  let saved: unknown = initialSnapshot ?? {
    associations: [
      { trackId: '一', tags: ['通勤'] },
      { trackId: '二', tags: ['通勤', '夜晚'] },
    ],
  }
  const write = vi.fn((value: unknown) => {
    saved = value
  })
  const session = createSession({
    read: () => saved,
    write,
    rememberTracks: vi.fn(),
    changed: () => revision.value++,
    isCurrent: () => true,
  })
  const records = computed(() => {
    void revision.value
    return session.project(tracks)
  })
  const tagDefinitions = computed(() => {
    void revision.value
    return session.tagDefinitions()
  })
  const playlistTags = computed(() => {
    void revision.value
    return session.tagsByPlaylistId()
  })
  let editor!: TagManagementPresentation
  const Editor = markRaw(
    defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h(
            Panel,
            {
              editing: session.editing,
              defaultTrackDisplayPreferences: defaultTrackDisplayPreferences.value,
              tagDefinitions: tagDefinitions.value,
              createTag: session.createTag,
              removeTagAssociations: session.removeTagAssociations,
              records: records.value,
              playlists: [
                {
                  playlist: {
                    id: 'p',
                    name: '通勤歌单',
                    trackIds: ['一', '二'],
                    createdAtMs: 1,
                    updatedAtMs: 1,
                  },
                  customTags: playlistTags.value.get('p') ?? [],
                  platformIds: [...new Set(['bilibili', secondPlatform])],
                },
              ],
              platforms: [
                { id: 'bilibili', name: '哔哩哔哩' },
                { id: 'douyin', name: '抖音' },
              ],
              errorMessage: '',
              onAddTag: session.addTag,
              onRemoveTag: session.removeTag,
              onRenameTag: session.renameTag,
              onDeleteTag: session.deleteTag,
              onDeleteTags: session.deleteTags,
              onMergeTags: session.mergeTags,
            },
            {
              default: (props: { editor: TagManagementPresentation }) => {
                editor = props.editor
                return slots.default?.(props)
              },
            },
          ),
    }),
  )
  const feature: UiThemeFeatureMap['tags'] = {
    availability: { status: 'available' },
    status: { status: 'ready' },
    state: { Editor },
    actions: { retry: vi.fn() },
  }
  let confirmation!: ConfirmationDialogController
  let feedback!: ReturnType<typeof provideActionFeedback>
  const Host = defineComponent({
    setup() {
      confirmation = provideConfirmationDialog()
      feedback = provideActionFeedback()
      return () =>
        h(theme.value.views.tags, { feature, ...(theme.value === classic ? { mobileLayout } : {}) })
    },
  })
  const root = new CatalogTestElement('root')
  const app = renderer.createApp(Host)
  app.mount(root)
  cleanup.push(() => {
    app.unmount()
    session.dispose()
  })
  const button = (text: string) =>
    findCatalogElement(root, (node) => node.tag === 'button' && node.textContent.includes(text))
  const click = async (text: string) => {
    dispatchCatalogEvent(button(text), 'onClick', false)
    await nextTick()
  }
  const element = (label: string) =>
    findCatalogElement(root, (node) => node.props['aria-label'] === label)
  const activate = async (label: string, event = 'onClick') => {
    dispatchCatalogEvent(element(label), event, false)
    await nextTick()
  }
  const input = async (label: string, value: string) => {
    const node = element(label)
    node.value = value
    dispatchCatalogEvent(node, 'onInput', false)
    await nextTick()
  }
  const submitRename = async () => {
    const node = element('标签的新名称').parent?.parent
    dispatchCatalogEvent(node!, 'onSubmit', false)
    await nextTick()
  }
  return {
    root,
    theme,
    defaultTrackDisplayPreferences,
    records,
    write,
    confirmation,
    get notice() {
      return feedback.notice.value
    },
    button,
    click,
    element,
    activate,
    input,
    submitRename,
    session,
    get editor() {
      return editor
    },
  }
}

it('hides the mobile heading and description while updating the top-bar count and selection summary', async () => {
  const view = mount(classic, true)
  expect(view.root.textContent).not.toContain('创建和整理标签，让音乐归类更轻松。')
  expect(view.element('标签管理共 2 个标签').textContent).toContain('个')
  expect(view.root.textContent).toContain('共 2')
  expect(view.root.textContent).toContain('已选 0 · 共 2')
  await view.click('创建标签')
  view.editor.actions.setCreateNameDraft('现场')
  view.editor.actions.createTag()
  await nextTick()
  expect(view.element('标签管理共 3 个标签').textContent).toContain('3')
})

describe.each([
  { name: 'Classic', theme: classic },
  { name: 'Studio', theme: studio },
])('$name tag directory', ({ theme }) => {
  it('keeps music selection across themes and removes only the selected label in one commit', async () => {
    const view = mount(theme)
    view.session.addPlaylistTag('p', '通勤')
    const writes = view.write.mock.calls.length
    await view.activate('查看标签 通勤')
    await view.click('关联音乐')
    expect(view.button('移除标签').props.disabled).toBe(true)
    const count = findCatalogElement(
      view.root,
      (node) => node.props.class === 'tag-details__remove-count',
    )
    expect(count.props.style).toMatchObject({ inlineSize: '0px' })
    await view.activate('选择歌曲 歌曲一', 'onChange')
    expect(
      findCatalogElement(view.root, (node) => node.props.class === 'tag-details__remove-count'),
    ).toBe(count)
    expect(count.props.style).toMatchObject({ inlineSize: 'calc(2em + 1ch)' })
    expect([...view.editor.state.detailSelectedIds]).toEqual(['一'])
    view.theme.value = theme === classic ? studio : classic
    await nextTick()
    expect(view.element('取消选择歌曲 歌曲一').props.checked).toBe(true)
    await view.activate('全选当前音乐')
    expect(view.editor.state.detailSelectedIds.size).toBe(2)
    await view.activate('全选当前音乐')
    expect(view.editor.state.detailSelectedIds.size).toBe(0)
    await view.activate('全选当前音乐')
    await view.click('移除标签')
    expect(view.write).toHaveBeenCalledTimes(writes)
    expect(view.confirmation.activeRequest.value?.message).toContain('2 首音乐')
    view.confirmation.cancel()
    await nextTick()
    await nextTick()
    expect(view.editor.state.detailSelectedIds.size).toBe(2)
    await view.click('移除标签')
    view.confirmation.accept()
    await nextTick()
    await nextTick()
    expect(view.write).toHaveBeenCalledTimes(writes + 1)
    expect(view.session.tagsByTrackId().get('一')).toEqual([])
    expect(view.session.tagsByTrackId().get('二')).toEqual(['夜晚'])
    expect(view.session.tagsByPlaylistId().get('p')).toEqual(['通勤'])
    expect(view.editor.state.detailSelectedIds.size).toBe(0)
  })

  it('selects associated playlists and removes their label without changing music tags', async () => {
    const view = mount(theme)
    view.session.addPlaylistTag('p', '通勤')
    view.session.addPlaylistTag('p', '保留')
    await nextTick()
    const writes = view.write.mock.calls.length
    await view.click('歌单标签')
    await view.activate('查看标签 通勤')
    await view.click('关联歌单')
    await view.activate('全选当前歌单')
    expect(view.editor.state.detailSelectedIds.has('p')).toBe(true)
    await view.click('移除标签')
    expect(view.confirmation.activeRequest.value?.message).toContain('1 个歌单')
    view.confirmation.accept()
    await nextTick()
    await nextTick()
    expect(view.write).toHaveBeenCalledTimes(writes + 1)
    expect(view.session.tagsByPlaylistId().get('p')).toEqual(['保留'])
    expect(view.session.tagsByTrackId().get('一')).toEqual(['通勤'])
    expect(view.session.tagsByTrackId().get('二')).toEqual(['通勤', '夜晚'])
    expect(view.editor.state.detailSelectedIds.size).toBe(0)
  })

  it('keeps association selection and shows the error when removal cannot be saved', async () => {
    const view = mount(theme)
    await view.activate('查看标签 通勤')
    await view.click('关联音乐')
    await view.activate('全选当前音乐')
    view.write.mockImplementation(() => {
      throw new Error('disk full')
    })
    await view.click('移除标签')
    view.confirmation.accept()
    await nextTick()
    await nextTick()
    await vi.waitFor(() => expect(view.editor.state.errorMessage).toBe('disk full'))
    expect(view.editor.state.detailSelectedIds.size).toBe(2)
    expect(view.session.tagsByTrackId().get('一')).toEqual(['通勤'])
    expect(view.session.tagsByTrackId().get('二')).toEqual(['通勤', '夜晚'])
  })

  it('rejects removal after closing and reopening the same detail or changing its associations', async () => {
    const view = mount(theme)
    await view.activate('查看标签 通勤')
    await view.click('关联音乐')
    await view.activate('全选当前音乐')
    const pending = view.editor.actions.removeSelectedDetailTags()
    view.editor.actions.closeDetail()
    view.editor.actions.activateTag('通勤')
    view.editor.actions.setDetailView('tracks')
    view.confirmation.accept()
    await pending
    expect(view.write).not.toHaveBeenCalled()
    expect(view.editor.state.detailSelectedIds.size).toBe(0)
    await nextTick()
    await view.activate('全选当前音乐')
    const changed = view.editor.actions.removeSelectedDetailTags()
    view.session.addTag(view.records.value[0]!.track, '新标签')
    await nextTick()
    view.confirmation.accept()
    await changed
    expect(view.write).toHaveBeenCalledTimes(1)
    expect(view.session.tagsByTrackId().get('一')).toEqual(['通勤', '新标签'])
  })

  it('switches association counts and browses readonly playlists across themes without writes', async () => {
    const view = mount(theme, false, 'douyin')
    view.session.addPlaylistTag('p', '通勤')
    await nextTick()
    const writes = view.write.mock.calls.length
    expect(view.editor.state.tagOptions.find(({ key }) => key === '通勤')?.count).toBe(2)
    await view.click('歌单标签')
    expect(view.editor.state.entityKind).toBe('playlists')
    expect(view.editor.state.tagOptions.find(({ key }) => key === '通勤')).toMatchObject({
      count: 1,
      platformIds: ['bilibili', 'douyin'],
    })
    await view.activate('查看标签 通勤')
    await view.click('覆盖平台')
    expect(view.element('覆盖平台统计').textContent).toContain('合计 1 个')
    await view.click('返回')
    await view.click('关联歌单')
    expect(view.element('关联歌单列表').textContent).toContain('通勤歌单')
    expect(() =>
      findCatalogElement(
        view.element('关联歌单列表'),
        (node) => node.props['aria-label'] === '查看 通勤歌单 的详细信息',
      ),
    ).toThrow()
    await view.activate('关联歌单展示方式')
    await view.click('排列方式')
    await view.click('一行两个')
    view.theme.value = theme === classic ? studio : classic
    await nextTick()
    expect(view.editor.state.entityKind).toBe('playlists')
    expect(view.editor.state.detailView).toBe('tracks')
    expect(
      findCatalogElement(
        view.element('关联歌单列表'),
        (node) => node.props['data-mobile-columns'] === 2,
      ),
    ).toBeTruthy()
    expect(view.write).toHaveBeenCalledTimes(writes)
    view.editor.actions.closeDetail()
    await nextTick()
    await view.click('音乐标签')
    expect(view.editor.state.tagOptions.find(({ key }) => key === '通勤')?.count).toBe(2)
    expect(view.editor.state.detailTag).toBeNull()
    expect(view.write).toHaveBeenCalledTimes(writes)
  })

  it('shows and deletes labels held only by playlists or missing songs, keeping song choices consistent', async () => {
    const view = mount(theme, false, 'bilibili', {
      associations: [{ trackId: 'missing-song', tags: ['2223'] }],
      playlistAssociations: [{ playlistId: 'p', tags: ['歌单专用'] }],
    })
    expect(view.editor.state.allTagOptions.map(({ name }) => name).toSorted()).toEqual(
      view.session.tagNames().toSorted(),
    )
    expect(view.editor.state.allTagOptions.every(({ count }) => count === 0)).toBe(true)
    expect(() => view.element('查看标签 2223')).not.toThrow()
    expect(() => view.element('查看标签 歌单专用')).not.toThrow()
    expect(view.write).not.toHaveBeenCalled()
    await view.click('操作器')
    await view.activate('全选当前匹配标签', 'onChange')
    await view.click('删除标签')
    expect(view.confirmation.activeRequest.value?.message).toContain('0 首歌曲')
    expect(view.confirmation.activeRequest.value?.message).toContain('歌单')
    view.confirmation.accept()
    await nextTick()
    await nextTick()
    expect(view.write).toHaveBeenCalledTimes(1)
    expect(view.session.tagNames()).toEqual([])
    expect(view.session.tagsByPlaylistId().size).toBe(0)
    await vi.waitFor(() => {
      expect(view.editor.state.allTagOptions).toEqual([])
      expect(() => view.element('选择标签 2223')).toThrow()
      expect(() => view.element('选择标签 歌单专用')).toThrow()
    })
  })

  it('creates an unused tag, keeps drafts across themes, and blocks duplicates with a top notice', async () => {
    const view = mount(theme)
    await view.click('创建标签')
    const input = () => findCatalogElement(view.root, (node) => node.props.name === 'tag-name')
    input().value = '  ＦＯＯ  '
    dispatchCatalogEvent(input(), 'onInput', false)
    view.theme.value = theme === classic ? studio : classic
    await nextTick()
    expect(input().value).toBe('  ＦＯＯ  ')
    const submit = async () => {
      dispatchCatalogEvent(view.element('创建标签'), 'onSubmit', false)
      await nextTick()
    }
    await submit()
    expect(view.write).toHaveBeenCalledTimes(1)
    expect(view.editor.state.createOpen).toBe(false)
    expect(view.editor.state.allTagOptions.find(({ key }) => key === 'foo')).toMatchObject({
      name: 'FOO',
      count: 0,
    })
    expect(() => view.element('查看标签 FOO')).not.toThrow()
    expect(view.records.value.every(({ customTags }) => !customTags.includes('FOO'))).toBe(true)
    await view.click('创建标签')
    input().value = 'foo'
    dispatchCatalogEvent(input(), 'onInput', false)
    await submit()
    expect(view.write).toHaveBeenCalledTimes(1)
    expect(view.editor.state.createOpen).toBe(true)
    expect(input().value).toBe('foo')
    expect(view.notice).toMatchObject({ tone: 'warning', message: '已存在重复标签。' })
    input().value = '通勤'
    dispatchCatalogEvent(input(), 'onInput', false)
    await submit()
    expect(view.write).toHaveBeenCalledTimes(1)
    expect(view.notice?.message).toBe('已存在重复标签。')
    view.editor.actions.cancelCreate()
    await nextTick()
    await view.click('创建标签')
    expect(input().value).toBe('')
  })

  it('keeps the creation form open and reports failed saves without publishing a label', async () => {
    const view = mount(theme)
    view.write.mockImplementation(() => {
      throw new Error('disk full')
    })
    await view.click('创建标签')
    view.editor.actions.setCreateNameDraft('现场')
    view.editor.actions.createTag()
    await nextTick()
    expect(view.editor.state.createOpen).toBe(true)
    expect(view.editor.state.createNameDraft).toBe('现场')
    expect(view.editor.state.allTagOptions).toHaveLength(2)
    expect(view.notice).toMatchObject({ tone: 'error', message: 'disk full' })
  })

  it('opens tag details normally and exposes checkboxes only in operator mode', async () => {
    const view = mount(theme)
    expect(view.root.textContent).toContain('标签管理')
    expect(() => view.element('选择标签 通勤')).toThrow()
    await view.activate('查看标签 通勤')
    expect(view.root.textContent).toContain('关联音乐 · 2 首')
    expect(view.write).not.toHaveBeenCalled()
    view.theme.value = theme === classic ? studio : classic
    await nextTick()
    expect(view.root.textContent).toContain('关联音乐 · 2 首')
  })

  it('previews tag filters, discards cancellation and applies a name query without writes', async () => {
    const view = mount(theme)
    await view.click('筛选器')
    await view.click('标签名称')
    await view.input('搜索标签名称', '通勤')
    expect(view.root.textContent).toContain('匹配 1 / 2 个标签')
    if (theme === classic) await view.click('确定')
    await view.click('取消')
    expect(() => view.element('查看标签 夜晚')).not.toThrow()
    await view.click('筛选器')
    if (theme === classic) await view.click('标签名称')
    expect(view.element('搜索标签名称').value).toBe('')
    await view.input('搜索标签名称', '通勤')
    if (theme === classic) await view.click('确定')
    await view.click('应用筛选')
    expect(view.root.textContent).toContain('匹配 1 / 2 个标签')
    expect(() => view.element('查看标签 夜晚')).toThrow()
    expect(view.write).not.toHaveBeenCalled()
  })

  it('retains multiple filter choices across themes and applies ordered sorting without writes', async () => {
    const view = mount(theme)
    const choose = async (value: string, label: string) => {
      if (view.theme.value === studio) await view.click(label)
      else {
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.tag === 'input' && node.props.value === value,
          ),
          'onChange',
          false,
        )
        await nextTick()
      }
    }
    const finish = async () => {
      if (view.theme.value === classic) await view.click('确定')
    }
    await view.click('筛选器')
    await view.click('关联歌曲')
    await choose('single', '仅关联一首')
    await choose('multiple', '关联多首')
    await finish()
    expect(view.editor.state.filterDraft?.usage).toEqual(['single', 'multiple'])
    view.theme.value = theme === classic ? studio : classic
    await nextTick()
    expect(view.editor.state.filterDraft?.usage).toEqual(['single', 'multiple'])
    await view.click('平台覆盖')
    await choose('single', '单个平台')
    await choose('multiple', '跨平台')
    await finish()
    await view.click('排序方式')
    await choose('usage-desc', '关联歌曲最多')
    await choose('updated-desc', '最近维护')
    await finish()
    expect(view.editor.state.filters.usage).toEqual([])
    await view.click('应用筛选')
    expect(view.editor.state.filters.usage).toEqual(['single', 'multiple'])
    expect(view.editor.state.filters.platformScope).toEqual(['single', 'multiple'])
    expect(view.editor.state.filters.sortMode).toEqual(['usage-desc', 'updated-desc'])
    expect(view.editor.state.tagOptions.map(({ name }) => name)).toEqual(['通勤', '夜晚'])
    expect(view.write).not.toHaveBeenCalled()
  })

  it('returns from the rename actions without saving the edited name', async () => {
    const view = mount(theme)
    await view.activate('查看标签 通勤')
    await view.click('修改标签')
    await view.input('标签的新名称', '未保存')
    const form = view.element('标签的新名称').parent!.parent!
    const buttons = descendants(form, 'button')
    expect(buttons.map((button) => button.textContent.trim())).toEqual(['返回', '保存名称'])
    const deleteButton = view.button('删除标签')
    expect(deleteButton.parent?.tag).toBe('header')
    expect(deleteButton.parent?.textContent).toContain('修改标签')
    expect(buttons[0]?.parent).toBe(buttons[1]?.parent)
    expect(buttons[0]?.props.type).toBe('button')
    expect(buttons[1]?.props.type).toBe('submit')
    await view.click('返回')
    expect(view.editor.state.detailView).toBe('actions')
    expect(view.editor.state.detailTag?.name).toBe('通勤')
    expect(view.write).not.toHaveBeenCalled()
  })

  it('confirms deletion from the edit heading and retains songs after accepting', async () => {
    const view = mount(theme)
    await view.activate('查看标签 通勤')
    await view.click('修改标签')
    await view.click('删除标签')
    expect(view.confirmation.activeRequest.value?.title).toBe('删除标签')
    expect(view.confirmation.activeRequest.value?.message).toContain('2 首歌曲')
    view.confirmation.cancel()
    await nextTick()
    expect(view.editor.state.detailTag?.name).toBe('通勤')
    expect(view.write).not.toHaveBeenCalled()
    await view.click('删除标签')
    view.confirmation.accept()
    await nextTick()
    await nextTick()
    expect(view.records.value).toHaveLength(2)
    expect(view.records.value.map(({ customTags }) => customTags)).toEqual([[], ['夜晚']])
    expect(view.write).toHaveBeenCalledTimes(1)
  })

  it('moves an overflowing description into a help dialog and restores it when space returns', async () => {
    let width = 300
    const observers: { target?: CatalogTestElement; notify(): void }[] = []
    const browser = new EventTarget()
    const prototype = CatalogTestElement.prototype
    Object.defineProperties(prototype, {
      ownerDocument: {
        configurable: true,
        get(this: CatalogTestElement) {
          return String(this.props.class).includes('tag-details-heading__description')
            ? { defaultView: browser }
            : undefined
        },
      },
      clientWidth: { configurable: true, get: () => width },
      scrollWidth: { configurable: true, get: () => 200 },
    })
    cleanup.push(() => {
      for (const key of ['ownerDocument', 'clientWidth', 'scrollWidth'])
        Reflect.deleteProperty(prototype, key)
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        entry: { target?: CatalogTestElement; notify(): void }
        constructor(notify: () => void) {
          this.entry = { notify }
          observers.push(this.entry)
        }
        observe(target: CatalogTestElement) {
          this.entry.target = target
        }
        disconnect() {}
      },
    )
    const view = mount(theme)
    await view.activate('查看标签 通勤')
    await view.click('修改标签')
    expect(() => view.element('修改标签说明')).toThrow()
    const description = observers.at(-1)!
    width = 150
    description.notify()
    await nextTick()
    expect(description.target?.props['aria-hidden']).toBe('true')
    await view.activate('修改标签说明')
    const explanation = findCatalogElement(view.root, (node) => node.props.title === '修改标签说明')
    expect(explanation.textContent).toContain('修改标签名称，或删除这个标签')
    const main = findCatalogElement(view.root, (node) => node.props.title === '标签信息')
    expect(main.props.suspended).toBe(true)
    ;(explanation.props.onClose as () => void)()
    await nextTick()
    expect(main.props.suspended).toBe(false)
    width = 300
    description.notify()
    await nextTick()
    expect(description.target?.props['aria-hidden']).toBeUndefined()
    expect(() => view.element('修改标签说明')).toThrow()
    expect(view.write).not.toHaveBeenCalled()
  })

  it('keeps a cancelled rename merge draft across themes and writes only after confirmation', async () => {
    const view = mount(theme)
    await view.activate('查看标签 通勤')
    await view.click('修改标签')
    await view.input('标签的新名称', '夜晚')
    await view.submitRename()
    expect(view.confirmation.activeRequest.value?.title).toBe('合并标签')
    expect(view.write).not.toHaveBeenCalled()
    view.confirmation.cancel()
    await nextTick()
    expect(view.element('标签的新名称').value).toBe('夜晚')
    view.theme.value = theme === classic ? studio : classic
    await nextTick()
    expect(view.element('标签的新名称').value).toBe('夜晚')
    await view.submitRename()
    view.confirmation.accept()
    await nextTick()
    await nextTick()
    expect(view.write).toHaveBeenCalledTimes(1)
    expect(view.records.value.map(({ customTags }) => customTags)).toEqual([['夜晚'], ['夜晚']])
  })

  it('shows described navigation and counts each covered platform without changing associations', async () => {
    const view = mount(theme, false, 'douyin')
    await view.activate('查看标签 通勤')
    for (const label of ['修改标签', '覆盖平台', '关联音乐']) {
      const entry = view.button(label)
      expect(descendants(entry, 'small')[0]?.textContent).toBeTruthy()
      expect(descendants(entry, 'svg')).toHaveLength(2)
    }
    expect(() => view.element('标签的新名称')).toThrow()
    await view.click('覆盖平台')
    const stats = view.element('覆盖平台统计')
    expect(descendants(stats, 'dt').map((node) => node.textContent)).toEqual(['哔哩哔哩', '抖音'])
    expect(descendants(stats, 'dd').map((node) => node.textContent)).toEqual(['1 首', '1 首'])
    expect(stats.textContent).toContain('合计 2 首')
    expect(descendants(stats, 'button')).toHaveLength(0)
    await view.click('返回')
    await view.click('关联音乐')
    const list = view.element('关联音乐列表')
    expect(list.textContent).toContain('歌曲一')
    expect(list.textContent).toContain('歌曲二')
    expect(descendants(list, 'button')).toHaveLength(3)
    expect(descendants(list, 'input')).toHaveLength(2)
    view.theme.value = theme === classic ? studio : classic
    await nextTick()
    expect(view.editor.state.detailView).toBe('tracks')
    expect(descendants(view.element('关联音乐列表'), 'button')).toHaveLength(3)
    expect(view.write).not.toHaveBeenCalled()
  })

  it('browses an unused tag and resets navigation on explicit close', async () => {
    const view = mount(theme)
    view.session.createTag('未使用')
    await nextTick()
    await view.activate('查看标签 未使用')
    await view.click('覆盖平台')
    expect(view.element('覆盖平台统计').textContent).toContain('合计 0 首')
    await view.click('返回')
    await view.click('关联音乐')
    expect(view.element('关联音乐列表').textContent).toContain('这个标签还没有关联音乐。')
    view.editor.actions.closeDetail()
    await nextTick()
    await view.activate('查看标签 通勤')
    expect(view.editor.state.detailView).toBe('actions')
  })

  it('inherits associated-music defaults and retains a local choice across themes until detail closes', async () => {
    const view = mount(theme)
    view.defaultTrackDisplayPreferences.value = {
      displayMode: 'compact',
      mobileColumns: 2,
      itemStyle: 'minimal',
    }
    await view.activate('查看标签 通勤')
    await view.click('关联音乐')
    const grid = () =>
      findCatalogElement(
        view.element('关联音乐列表'),
        (node) => node.props['data-display-mode'] !== undefined,
      )
    expect(grid().props).toMatchObject({
      'data-display-mode': 'compact',
      'data-mobile-columns': 2,
    })
    view.defaultTrackDisplayPreferences.value = {
      displayMode: 'comfortable',
      mobileColumns: 1,
      itemStyle: 'minimal',
    }
    await nextTick()
    expect(grid().props).toMatchObject({
      'data-display-mode': 'comfortable',
      'data-mobile-columns': 1,
    })
    await view.activate('关联音乐展示方式')
    await view.click('排列方式')
    await view.click('紧凑')
    view.defaultTrackDisplayPreferences.value = {
      displayMode: 'standard',
      mobileColumns: 2,
      itemStyle: 'default',
    }
    view.theme.value = theme === classic ? studio : classic
    await nextTick()
    expect(grid().props).toMatchObject({
      'data-display-mode': 'compact',
      'data-mobile-columns': 1,
    })
    view.editor.actions.closeDetail()
    await nextTick()
    await view.activate('查看标签 通勤')
    await view.click('关联音乐')
    await view.activate('关联音乐展示方式')
    await view.click('风格选择')
    expect(view.button('直显').props['aria-pressed']).toBe(true)
    expect(view.write).not.toHaveBeenCalled()
  })

  it('filters readonly music with the existing editor, retains results across themes, and clears on close', async () => {
    const view = mount(theme)
    await view.activate('查看标签 通勤')
    await view.click('关联音乐')
    await view.activate('选择歌曲 歌曲一', 'onChange')
    await view.activate('关联音乐筛选器')
    if (theme === classic) await view.click('搜索筛选')
    const search = findCatalogElement(
      view.root,
      (node) => node.tag === 'input' && node.props.type === 'search',
    )
    search.value = '歌曲二'
    dispatchCatalogEvent(search, 'onInput', false)
    await nextTick()
    if (theme === classic) await view.click('确定')
    await view.click('应用筛选')
    expect(view.element('关联音乐列表').textContent).toContain('已选 1 个')
    expect(() => view.element('选择歌曲 歌曲一')).toThrow()
    expect(() => view.element('选择歌曲 歌曲二')).not.toThrow()
    await view.activate('全选当前音乐')
    expect([...view.editor.state.detailSelectedIds].toSorted()).toEqual(['一', '二'])
    expect(view.element('全选当前音乐').props['aria-pressed']).toBe(true)
    await view.activate('全选当前音乐')
    expect([...view.editor.state.detailSelectedIds]).toEqual(['一'])
    view.theme.value = theme === classic ? studio : classic
    await nextTick()
    expect(view.element('关联音乐列表').textContent).toContain('已选 1 个')
    expect(() => view.element('取消选择歌曲 歌曲一')).toThrow()
    expect(() => view.element('选择歌曲 歌曲二')).not.toThrow()
    await view.activate('关联音乐展示方式')
    await view.click('风格选择')
    await view.click('留白')
    expect(descendants(view.element('关联音乐列表'), 'button')).toHaveLength(3)
    expect(view.write).not.toHaveBeenCalled()
    view.editor.actions.closeDetail()
    await nextTick()
    expect(view.editor.state.detailSelectedIds.size).toBe(0)
    await view.activate('查看标签 通勤')
    await view.click('关联音乐')
    expect(view.element('关联音乐列表').textContent).toContain('已选 0 个')
    expect(() => view.element('选择歌曲 歌曲一')).not.toThrow()
    expect(() => view.element('选择歌曲 歌曲二')).not.toThrow()
  })

  it('selects visible labels, confirms global song impact and batch deletes in one write', async () => {
    const view = mount(theme)
    await view.click('操作器')
    await view.activate('全选当前匹配标签', 'onChange')
    expect(() => view.element('标签的新名称')).toThrow()
    await view.click('删除标签')
    expect(view.confirmation.activeRequest.value?.message).toContain('2 首歌曲')
    view.confirmation.cancel()
    await nextTick()
    expect(view.write).not.toHaveBeenCalled()
    await view.click('删除标签')
    view.confirmation.accept()
    await nextTick()
    await nextTick()
    expect(view.write).toHaveBeenCalledTimes(1)
    expect(view.records.value.map(({ customTags }) => customTags)).toEqual([[], []])
  })

  it('keeps row display and selection across themes, then merges selected tags atomically', async () => {
    const view = mount(theme)
    await view.activate('标签展示方式')
    await view.click('单独一行')
    await view.click('操作器')
    await view.activate('选择标签 通勤', 'onChange')
    await view.activate('选择标签 夜晚', 'onChange')
    view.theme.value = theme === classic ? studio : classic
    await nextTick()
    expect(view.element('选择标签 通勤').props.checked).toBe(true)
    await view.activate('标签展示方式')
    expect(view.button('单独一行').props['aria-pressed']).toBe(true)
    await view.click('默认撑满')
    await view.click('合并标签')
    await view.input('合并后的标签名称', '场景')
    dispatchCatalogEvent(view.element('合并后的标签名称').parent!.parent!, 'onSubmit', false)
    await nextTick()
    expect(view.confirmation.activeRequest.value?.title).toBe('合并标签')
    expect(view.write).not.toHaveBeenCalled()
    view.confirmation.accept()
    await nextTick()
    await nextTick()
    expect(view.write).toHaveBeenCalledTimes(1)
    expect(view.records.value.map(({ customTags }) => customTags)).toEqual([['场景'], ['场景']])
  })

  it('does not replay a pending destructive confirmation after its presentation is replaced', async () => {
    const view = mount(theme)
    await view.activate('查看标签 通勤')
    const pending = view.editor.actions.deleteTag('通勤')
    const rejected = expect(pending).rejects.toThrow('会话已失效')
    view.theme.value = theme === classic ? studio : classic
    await nextTick()
    view.confirmation.accept()
    await rejected
    expect(view.write).not.toHaveBeenCalled()
  })
  it('retains global affected-song counts when a platform and name filter show only one label', async () => {
    const view = mount(theme)
    view.editor.actions.setFilters({
      ...view.editor.state.filters,
      selectedPlatformIds: ['bilibili'],
      searchQuery: '通',
    })
    await nextTick()
    await view.click('操作器')
    await view.activate('全选当前匹配标签', 'onChange')
    expect(view.editor.state.selectedTags).toHaveLength(1)
    expect(view.editor.state.selectedTags[0]?.count).toBe(2)
    const pending = view.editor.actions.deleteSelectedTags()
    expect(view.confirmation.activeRequest.value?.message).toContain('2 首歌曲')
    view.confirmation.cancel()
    await pending
    expect(view.write).not.toHaveBeenCalled()
  })
  it('invalidates a pending confirmation when the underlying associations change', async () => {
    const view = mount(theme)
    const pending = view.editor.actions.deleteTag('通勤')
    view.session.addTag(view.records.value[0]!.track, '现场')
    view.confirmation.accept()
    await pending
    expect(view.write).toHaveBeenCalledTimes(1)
    expect(view.records.value[0]?.customTags).toEqual(['通勤', '现场'])
  })
})
