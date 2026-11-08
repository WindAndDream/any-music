import { createThemeController, createThemeResources } from '@any-music/plugin-ui-vue/trusted'
import type { ThemeAllocation, ThemeApplicationComposition } from '@any-music/plugin-ui-vue/trusted'
import { UI_THEME_SELECTION } from '@any-music/ui'
import type { UiThemeOptionalView } from '@any-music/ui/theme'
import { computed, onMounted, onScopeDispose, provide, shallowRef } from 'vue'

import type { WorkbenchRuntime } from '../../runtime/workbench-runtime'

const STORAGE_KEY = 'ui-theme:v1'
interface ThemePreferences {
  themeId: string
  settingsByTheme: Record<string, unknown>
}

/** Stable preferences above replaceable complete-theme roots. */
export function useWorkbenchThemeSession(
  runtime: WorkbenchRuntime,
  getRoot: () => HTMLElement | ShadowRoot | undefined,
  composition: ThemeApplicationComposition,
  prepareAllocation?: (id: string) => Promise<ThemeAllocation>,
  requiredOptionalViews?: () => readonly UiThemeOptionalView[],
  onUnavailable?: (reason: string) => void,
) {
  let saved: ThemePreferences = { themeId: 'default', settingsByTheme: {} }
  const failureKind = shallowRef<'theme' | 'storage-read' | 'storage-write'>()
  let disposed = false
  let generation = 0
  let readFailed = false
  try {
    const input = runtime.storage.read<Partial<ThemePreferences>>(STORAGE_KEY)
    if (
      input &&
      typeof input.themeId === 'string' &&
      input.settingsByTheme &&
      typeof input.settingsByTheme === 'object' &&
      !Array.isArray(input.settingsByTheme)
    )
      saved = { themeId: input.themeId, settingsByTheme: input.settingsByTheme }
  } catch {
    failureKind.value = 'storage-read'
    readFailed = true
  }
  const controller = createThemeController({
    composition,
    form: runtime.modules?.form ?? 'desktop',
    resources: createThemeResources(getRoot),
    prepareAllocation,
    requiredOptionalViews,
    fallbackSettings: () => saved.settingsByTheme[composition.fallback.descriptor.id],
    onFailure: () => {
      failureKind.value = 'theme'
    },
  })
  const currentId = () => {
    const theme = controller.current.value.theme
    return theme.definition.id
  }
  async function select(id: string, startup = false) {
    if (disposed) return
    const reason = composition.themes.find((entry) => entry.descriptor.id === id)?.descriptor
      .unavailableReason
    if (reason) {
      // Never call the loader or allocation hook, including for a saved startup preference.
      if (startup) await select(composition.fallback.descriptor.id, true)
      else onUnavailable?.(reason)
      return
    }
    const requestedGeneration = ++generation
    if (!startup) failureKind.value = undefined
    const selected = await controller.select(id, saved.settingsByTheme[id])
    if (!selected || disposed || requestedGeneration !== generation) return
    if (controller.needsRecovery.value || currentId() !== id) return
    // A failed startup read must not overwrite unread preferences with defaults.
    if (startup && readFailed) return
    saved = {
      ...saved,
      themeId: id,
      settingsByTheme: { ...saved.settingsByTheme, [id]: controller.current.value.settings },
    }
    try {
      runtime.storage.write(STORAGE_KEY, saved)
    } catch {
      failureKind.value = 'storage-write'
    }
  }
  const error = computed(() => {
    if (failureKind.value === 'storage-write')
      return '界面主题偏好保存失败，当前主题仍可使用。可重新选择主题以重试保存。'
    if (failureKind.value === 'storage-read') return '界面主题偏好读取失败。可重新选择主题以重试。'
    if (failureKind.value === 'theme')
      return currentId() === 'default' && !controller.needsRecovery.value
        ? '界面主题不可用，已使用默认主题。可重新选择主题以重试。'
        : '界面主题不可用。可重试或恢复默认主题。'
    return ''
  })
  provide(UI_THEME_SELECTION, {
    choices: composition.themes.map((entry) => entry.descriptor),
    currentId,
    select: (id) => {
      void select(id)
    },
    error: () => error.value,
  })
  onMounted(() => {
    void select(saved.themeId, true)
  })
  onScopeDispose(() => {
    disposed = true
    generation++
    controller.dispose()
  })
  return {
    current: controller.current,
    error,
    failure: computed(() => failureKind.value !== undefined),
    needsRecovery: controller.needsRecovery,
    reportRenderFailure: controller.reportRenderFailure,
    select,
    restoreDefault: () => select('default'),
  }
}
