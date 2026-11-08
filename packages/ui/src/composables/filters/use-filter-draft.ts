import { shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { ShallowRef } from 'vue'

import { editingStateKey, useEditingSession } from '../use-editing-session'
import type { EditingSession, EditingStateKey } from '../use-editing-session'

interface FilterDraftState<State> {
  draft: ShallowRef<State>
  preview: ShallowRef<State>
  open: boolean
}
// Each view's editing scope owns one filter transaction, regardless of its state shape.
const FILTER_DRAFT = editingStateKey<FilterDraftState<unknown>>('filter-draft')

interface UseFilterDraftOptions<State> {
  editing?: EditingSession
  applied: MaybeRefOrGetter<State>
  open: MaybeRefOrGetter<boolean>
  clone: (state: State) => State
  apply: (state: State) => void
}

/** 共享筛选事务：预览与草稿可编辑，打开/关闭恢复快照，只有明确应用才写回业务状态。
 * 匹配规则与状态结构由调用方提供，因此其他板块不必依赖歌曲筛选的维度模型。
 */
export function useFilterDraft<State>(options: UseFilterDraftOptions<State>) {
  const editing = options.editing ?? useEditingSession()
  const state = editing.state(FILTER_DRAFT as EditingStateKey<FilterDraftState<State>>, () => {
    const draft = shallowRef(options.clone(toValue(options.applied))) as ShallowRef<State>
    return {
      draft,
      preview: shallowRef(options.clone(draft.value)) as ShallowRef<State>,
      open: toValue(options.open),
    }
  })
  const { draft, preview } = state

  function resetDraft(): void {
    editing.clearScope('filter-panel')
    draft.value = options.clone(toValue(options.applied))
    preview.value = options.clone(draft.value)
  }

  function applyDraft(): void {
    options.apply(options.clone(draft.value))
  }

  watch(
    () => toValue(options.open),
    (open) => {
      if (open === state.open) return
      state.open = open
      resetDraft()
    },
    { immediate: true },
  )
  return { draft, preview, resetDraft, applyDraft }
}
