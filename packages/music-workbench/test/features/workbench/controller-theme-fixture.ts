import { computed } from 'vue'

import { createWorkbenchThemeFeatures } from '../../../src/features/workbench/create-workbench-theme-features'
import type { WorkbenchController } from '../../../src/features/workbench/use-workbench-controller'

/** Exercise the production projection with both real roots; only the media/runtime ports are doubles. */
export function createControllerThemeFixture(controller: WorkbenchController) {
  const features = createWorkbenchThemeFeatures(controller, {})
  return { features, selected: computed(() => features.value.catalog.state.selectedTrackIds) }
}
