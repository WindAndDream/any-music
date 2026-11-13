import type { ThemeAllocation, ThemeApplicationComposition } from '@any-music/plugin-ui-vue/trusted'
import type { UiThemeOptionalView } from '@any-music/ui/theme'

import type { WorkbenchRuntime } from '../../runtime/workbench-runtime'
import { useWorkbenchThemeSession } from './use-workbench-theme-session'

/** Complete-root host composition; no business factories or concrete-theme graph. */
export function useWorkbenchRootTheme(
  runtime: WorkbenchRuntime,
  getRoot: () => ShadowRoot | undefined,
  composition: ThemeApplicationComposition,
  options: {
    prepareAllocation?: (id: string) => Promise<ThemeAllocation>
    requiredOptionalViews?: () => readonly UiThemeOptionalView[]
    onUnavailable?: (reason: string) => void
  } = {},
) {
  return useWorkbenchThemeSession(
    runtime,
    getRoot,
    composition,
    options.prepareAllocation,
    options.requiredOptionalViews,
    options.onUnavailable,
  )
}
