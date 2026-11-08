import { provideConfirmationDialog } from '@any-music/ui'
import type { TagManagementFilterState, TagManagementPresentation } from '@any-music/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import TagManagementFilters from '../../../src/components/specialists/TagManagementFilters.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

const transitionControl = vi.hoisted(() => ({
  hold: false,
  finish: undefined as (() => void) | undefined,
}))

function finishTransition(): void {
  transitionControl.finish?.()
}

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup(_props, { slots, attrs }) {
        let previousKey: unknown
        return () => {
          const children = slots.default?.()
          const key = children?.[0]?.key
          if (previousKey !== undefined && key !== previousKey) {
            const finish = () => (attrs.onAfterLeave as (() => void) | undefined)?.()
            if (transitionControl.hold) transitionControl.finish = finish
            else finish()
          }
          previousKey = key
          return children
        }
      },
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
beforeEach(() => vi.stubGlobal('Document', CatalogTestElement))
afterEach(() => {
  transitionControl.hold = false
  transitionControl.finish = undefined
  vi.unstubAllGlobals()
})

function createFilters(): TagManagementFilterState {
  return {
    searchQuery: '',
    selectedPlatformIds: [],
    usage: [],
    platformScope: [],
    sortMode: [],
  }
}

async function changeChoice(node: CatalogTestElement): Promise<void> {
  dispatchCatalogEvent(node, 'onChange', false)
  await nextTick()
}

function mountFilters() {
  const filters = shallowRef(createFilters())
  const draft = shallowRef<TagManagementFilterState | null>(createFilters())
  const resultCount = shallowRef(2)
  let confirmation!: ReturnType<typeof provideConfirmationDialog>
  const editor = {
    state: {
      get filterDraft() {
        return draft.value
      },
      get filterPreviewCount() {
        return resultCount.value
      },
      allTagOptions: [{ name: '通勤' }, { name: '放松' }],
      taggedRecords: [{}, {}, {}],
      platformOptions: [
        { id: 'a', name: '平台甲', count: 2, isCustom: false },
        { id: 'b', name: '平台乙', count: 1, isCustom: false },
      ],
    },
    actions: {
      setFilterDraft: (value: TagManagementFilterState) => {
        draft.value = value
      },
      applyFilters: () => {
        if (draft.value) filters.value = draft.value
        draft.value = null
      },
      cancelFilters: () => {
        draft.value = null
      },
    },
  } as unknown as TagManagementPresentation
  const host = defineComponent({
    setup() {
      confirmation = provideConfirmationDialog()
      return () => h(TagManagementFilters, { editor })
    },
  })
  const view = mountCatalogComponent(host, {})
  const click = async (label: string) => {
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent.trim() === label,
      ),
      'onClick',
      false,
    )
    await nextTick()
  }
  const edit = async (dimension: keyof TagManagementFilterState) => {
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['data-filter-dimension'] === dimension),
      'onClick',
      false,
    )
    await nextTick()
  }
  return { ...view, filters, draft, resultCount, confirmation, click, edit }
}

describe('TagManagementFilters', () => {
  it.each(['返回', '确定'])(
    'keeps the outer footer stable until %s finishes leaving',
    async (label) => {
      const view = mountFilters()
      const hasApply = () => view.root.textContent.includes('应用筛选')
      try {
        transitionControl.hold = true
        expect(hasApply()).toBe(true)
        await view.edit('usage')
        expect(hasApply()).toBe(true)
        expect(transitionControl.finish).toBeDefined()
        finishTransition()
        await nextTick()
        expect(hasApply()).toBe(false)

        transitionControl.finish = undefined
        await view.click(label)
        expect(hasApply()).toBe(false)
        expect(transitionControl.finish).toBeDefined()
        finishTransition()
        await nextTick()
        expect(hasApply()).toBe(true)
      } finally {
        view.unmount()
      }
    },
  )

  it('restores the overview footer when closed in a detail and reopened', async () => {
    const view = mountFilters()
    try {
      await view.edit('usage')
      expect(view.root.textContent).not.toContain('应用筛选')
      view.draft.value = null
      await nextTick()
      view.draft.value = createFilters()
      await nextTick()
      expect(view.root.textContent).toContain('全部标签')
      expect(view.root.textContent).toContain('应用筛选')
    } finally {
      view.unmount()
    }
  })

  it('previews the plugin draft, returns without committing a dimension, and applies only explicitly', async () => {
    const view = mountFilters()
    try {
      expect(view.root.textContent).toContain('全部标签')
      expect(view.root.textContent).toContain('已标记音乐 3 首')
      await view.edit('searchQuery')
      const input = findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '搜索标签名称',
      )
      input.value = '通勤'
      dispatchCatalogEvent(input, 'onInput', false)
      await nextTick()
      expect(view.draft.value?.searchQuery).toBe('通勤')
      expect(view.filters.value.searchQuery).toBe('')
      view.resultCount.value = 1
      await nextTick()
      expect(view.root.textContent).toContain('筛选预览1 / 2 个标签')
      expect(() =>
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent === '应用筛选',
        ),
      ).toThrow()
      await view.click('返回')
      expect(view.draft.value?.searchQuery).toBe('')
      await view.edit('searchQuery')
      const nextInput = findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '搜索标签名称',
      )
      nextInput.value = '放松'
      dispatchCatalogEvent(nextInput, 'onInput', false)
      await view.click('确定')
      expect(view.root.textContent).toContain('放松')
      expect(view.filters.value.searchQuery).toBe('')
      await view.click('应用筛选')
      expect(view.filters.value.searchQuery).toBe('放松')
      expect(view.draft.value).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it.each([
    ['usage', 'multiple'],
    ['platformScope', 'single'],
    ['sortMode', 'name-asc'],
  ] as const)('edits %s and discards the whole draft on cancel', async (dimension, value) => {
    const view = mountFilters()
    try {
      await view.edit(dimension)
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.tag === 'input' && node.props.value === value),
        'onChange',
        false,
      )
      await view.click('确定')
      expect(view.draft.value?.[dimension]).toEqual([value])
      expect(view.root.textContent).toContain('已筛选 1 项')
      await view.click('取消')
      expect(view.filters.value).toEqual(createFilters())
      expect(view.draft.value).toBeNull()
      view.draft.value = { ...createFilters(), searchQuery: '重新打开' }
      await nextTick()
      expect(view.root.textContent).toContain('重新打开')
    } finally {
      view.unmount()
    }
  })

  it.each([
    ['selectedPlatformIds', 'a', 'b', '全部关联平台'],
    ['usage', 'single', 'multiple', '全部歌曲数量'],
    ['platformScope', 'single', 'multiple', '全部平台覆盖'],
    ['sortMode', 'usage-desc', 'updated-desc', '全部排序方式'],
  ] as const)(
    'supports multiple %s choices with an exclusive all option and dimension rollback',
    async (dimension, first, second, allLabel) => {
      const view = mountFilters()
      try {
        await view.edit(dimension)
        const choice = (value: string) =>
          findCatalogElement(
            view.root,
            (node) => node.tag === 'input' && node.props.value === value,
          )
        const all = () =>
          findCatalogElement(
            view.root,
            (node) => node.tag === 'input' && node.parent?.textContent.includes(allLabel) === true,
          )
        expect(all().props.type).toBe('radio')
        expect(all().props.checked).toBe(true)
        expect(choice(first).props.type).toBe('checkbox')
        await changeChoice(choice(first))
        await changeChoice(choice(second))
        expect(view.draft.value?.[dimension]).toEqual([first, second])
        expect(all().props.checked).toBe(false)
        expect(choice(first).props.checked).toBe(true)
        expect(choice(second).props.checked).toBe(true)
        await view.click('返回')
        expect(view.draft.value?.[dimension]).toEqual([])
        await view.edit(dimension)
        await changeChoice(choice(first))
        await changeChoice(choice(second))
        await changeChoice(choice(first))
        expect(view.draft.value?.[dimension]).toEqual([second])
        await changeChoice(all())
        expect(view.draft.value?.[dimension]).toEqual([])
        expect(choice(second).props.checked).toBe(false)
        await changeChoice(choice(first))
        await changeChoice(choice(first))
        expect(all().props.checked).toBe(true)
      } finally {
        view.unmount()
      }
    },
  )

  it.each([
    ['selectedPlatformIds', ['b', 'a'], '关联平台', '平台乙', ['a']],
    ['usage', ['single', 'multiple'], '关联歌曲', '仅关联一首', ['multiple']],
    ['platformScope', ['multiple', 'single'], '平台覆盖', '跨平台', ['single']],
    ['sortMode', ['usage-desc', 'updated-desc'], '排序方式', '1. 关联歌曲最多', ['updated-desc']],
  ] as const)(
    'removes an individual %s condition in summary order',
    async (dimension, selection, label, first, remaining) => {
      const view = mountFilters()
      try {
        view.draft.value = { ...createFilters(), [dimension]: selection }
        await nextTick()
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.props['aria-label'] === `删除${label}条件 ${first}`,
          ),
          'onClick',
          false,
        )
        await nextTick()
        expect(view.draft.value?.[dimension]).toEqual(remaining)
        expect(view.filters.value).toEqual(createFilters())
        if (dimension === 'sortMode') expect(view.root.textContent).toContain('1. 最近维护')
      } finally {
        view.unmount()
      }
    },
  )

  it('confirms clearing and ignores confirmation after the draft has been replaced', async () => {
    const view = mountFilters()
    try {
      view.draft.value = { ...createFilters(), searchQuery: '通勤' }
      await nextTick()
      await view.click('清空全部')
      expect(view.confirmation.activeRequest.value?.title).toBe('清空全部筛选？')
      expect(view.draft.value.searchQuery).toBe('通勤')
      view.draft.value = { ...createFilters(), searchQuery: '放松' }
      view.confirmation.accept()
      await nextTick()
      expect(view.draft.value.searchQuery).toBe('放松')
      await view.click('清空全部')
      view.confirmation.accept()
      await nextTick()
      expect(view.draft.value).toEqual(createFilters())
      expect(view.filters.value).toEqual(createFilters())
    } finally {
      view.unmount()
    }
  })
})
