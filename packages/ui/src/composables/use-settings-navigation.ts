import type { ShallowRef } from 'vue'
import { computed, nextTick, onScopeDispose, readonly, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import type { SettingsNavigationProps, SettingsSectionId } from '../product/settings-navigation'
import { useBackHandler } from './use-back-navigation'
import { editingStateKey, useEditingSession } from './use-editing-session'

interface UseSettingsNavigationOptions {
  props: Readonly<SettingsNavigationProps>
  navigation: Ref<HTMLElement | null>
  detail: Ref<HTMLElement | null>
  onSelectSection?: (id: SettingsSectionId | null) => void
}

/** 设置子页共享导航与焦点生命周期；访问过的表单保留草稿，关闭设置后统一卸载。 */
export function useSettingsNavigation(options: UseSettingsNavigationOptions) {
  const { props, navigation, detail } = options
  const session = useEditingSession('settings')
  let active = true
  const entries = computed(() => props.groups.flatMap((group) => group.entries))
  const selectedSectionId = useEditingSession('settings').state(selectedSectionIdKey, () =>
    shallowRef<SettingsSectionId | null>(null),
  )
  const displayedSectionId = useEditingSession('settings').state(displayedSectionIdKey, () =>
    shallowRef<SettingsSectionId | null>(null),
  )
  const visitedSectionIds = useEditingSession('settings').state(visitedSectionIdsKey, () =>
    shallowRef<readonly SettingsSectionId[]>([]),
  )
  const selectedEntry = computed(() =>
    entries.value.find((entry) => entry.id === displayedSectionId.value),
  )
  let navigationScrollTop = 0
  let focusGeneration = 0

  function setSection(sectionId: SettingsSectionId | null): void {
    selectedSectionId.value = sectionId
    // 返回时保留离场子页的画面，外层 inert 已立即停用交互，滑出过程不会闪成空白。
    if (sectionId) displayedSectionId.value = sectionId
    if (sectionId && !visitedSectionIds.value.includes(sectionId)) {
      visitedSectionIds.value = [...visitedSectionIds.value, sectionId]
    }
  }

  watch(
    () => props.initialSection,
    (initialSection, previousSection) => {
      if (previousSection === undefined && visitedSectionIds.value.length) return
      const section = entries.value.find((entry) => entry.id === initialSection)
      setSection(section?.id ?? (props.isMobileLayout ? null : (entries.value[0]?.id ?? null)))
    },
    { immediate: true },
  )
  watch(
    entries,
    (available) => {
      const ids = new Set(available.map((entry) => entry.id))
      visitedSectionIds.value = visitedSectionIds.value.filter((id) => ids.has(id))
      if (displayedSectionId.value && !ids.has(displayedSectionId.value)) {
        focusGeneration++
        displayedSectionId.value = null
        setSection(props.isMobileLayout ? null : (available[0]?.id ?? null))
      }
    },
    { flush: 'sync' },
  )
  watch(
    () => props.isMobileLayout,
    (isMobileLayout) => {
      if (!isMobileLayout && !selectedSectionId.value) setSection(entries.value[0]?.id ?? null)
    },
  )

  async function openSection(sectionId: SettingsSectionId): Promise<void> {
    if (!active || !session.active) return
    if (!entries.value.some((entry) => entry.id === sectionId)) return
    if (props.isMobileLayout && selectedSectionId.value === null) {
      navigationScrollTop = navigation.value?.scrollTop ?? 0
    }
    const generation = ++focusGeneration
    setSection(sectionId)
    options.onSelectSection?.(sectionId)
    await nextTick()
    if (!active || !session.active || generation !== focusGeneration) return
    if (detail.value) detail.value.scrollTop = 0
    detail.value
      ?.querySelector<HTMLElement>('[data-settings-heading]')
      ?.focus({ preventScroll: true })
  }

  async function returnToOverview(): Promise<void> {
    if (!active || !session.active) return
    const previousSectionId = selectedSectionId.value
    const generation = ++focusGeneration
    setSection(null)
    options.onSelectSection?.(null)
    await nextTick()
    if (!active || !session.active || generation !== focusGeneration) return
    if (navigation.value) navigation.value.scrollTop = navigationScrollTop
    navigation.value
      ?.querySelector<HTMLElement>(`[data-settings-entry="${previousSectionId}"]`)
      ?.focus({ preventScroll: true })
  }

  // 关闭设置或快速切页时，过期的 nextTick 不得把焦点拉回已经离开的页面。
  onScopeDispose(() => {
    active = false
    focusGeneration++
  })
  useBackHandler({
    active: () =>
      active && session.active && props.isMobileLayout && selectedSectionId.value !== null,
    handle: () => void returnToOverview(),
  })

  return {
    selectedEntry,
    selectedSectionId: readonly(selectedSectionId),
    displayedSectionId: readonly(displayedSectionId),
    visitedSectionIds: readonly(visitedSectionIds),
    openSection,
    returnToOverview,
  }
}

const selectedSectionIdKey = editingStateKey<ShallowRef<SettingsSectionId | null>>(
  'settings:selectedSectionId',
)

const displayedSectionIdKey = editingStateKey<ShallowRef<SettingsSectionId | null>>(
  'settings:displayedSectionId',
)

const visitedSectionIdsKey = editingStateKey<ShallowRef<readonly SettingsSectionId[]>>(
  'settings:visitedSectionIds',
)
