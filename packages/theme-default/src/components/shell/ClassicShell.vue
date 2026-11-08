<script setup lang="ts">
import type { AppShellPreferences, ProductViewId } from '@any-music/ui'
import { createDefaultAppShellPreferences } from '@any-music/ui'
import type { UiThemeFeatureMap, UiThemeForm } from '@any-music/ui/theme'
import { computed, shallowRef } from 'vue'

import ClassicNavigation from './ClassicNavigation.vue'
import ProductWorkbench from './ProductWorkbench.vue'

const props = defineProps<{
  feature: UiThemeFeatureMap['shell']
  navigation?: UiThemeFeatureMap['navigation']
  form?: UiThemeForm
  modalOpen?: boolean
  playerModalOpen?: boolean
}>()
defineSlots<{
  default?: () => unknown
  player?: () => unknown
  source?: () => unknown
  session?: () => unknown
  overlays?: () => unknown
}>()
// Only transient presentation state; persisted navigation and product visibility stay host-owned.
const drawerOpen = shallowRef(false)
const preferencesOpen = shallowRef(false)
const mobileLayout = computed(() => props.feature.state.mobileLayout ?? props.form === 'mobile')
const preferences = computed(
  () => props.navigation?.state.preferences ?? createDefaultAppShellPreferences(),
)
const destinations = computed(() => props.feature.state.destinations)
const activeDestination = computed(
  () =>
    destinations.value.find(({ id }) => id === props.feature.state.activeViewId) ??
    destinations.value[0],
)
const items = computed(() =>
  preferences.value.destinationOrder.flatMap((id) => {
    const entry = destinations.value.find((item) => item.id === id)
    return entry && !preferences.value.hiddenDestinationIds.includes(id) ? [entry] : []
  }),
)
const mobileItems = computed(() => items.value.filter((entry) => entry.mobileSlot))
function navigate(id: string): void {
  if (
    props.feature.availability.status !== 'available' ||
    !destinations.value.some((entry) => entry.id === id)
  )
    return
  props.feature.actions.navigate(id as ProductViewId)
  drawerOpen.value = false
}
function openSettings(): void {
  drawerOpen.value = false
  preferencesOpen.value = false
  props.feature.actions.openSettings()
}
const sidebarNavigation = computed(() =>
  props.navigation
    ? {
        ...props.navigation,
        actions: {
          ...props.navigation.actions,
          navigate: (id: ProductViewId) => {
            if (props.navigation?.availability.status !== 'available') return
            props.navigation.actions.navigate(id)
            drawerOpen.value = false
          },
        },
      }
    : undefined,
)
function updatePreferences(value: Partial<AppShellPreferences>): void {
  if (props.navigation?.availability.status === 'available')
    props.navigation.actions.setPreferences({ ...preferences.value, ...value })
}
function setVisible(id: ProductViewId, visible: boolean): void {
  const entry = destinations.value.find((item) => item.id === id)
  if (!entry?.canHide) return
  updatePreferences({
    hiddenDestinationIds: visible
      ? preferences.value.hiddenDestinationIds.filter((item) => item !== id)
      : [...new Set([...preferences.value.hiddenDestinationIds, id])],
  })
}
function moveDestination(id: ProductViewId, offset: -1 | 1): void {
  const order = [...preferences.value.destinationOrder]
  const index = order.indexOf(id),
    next = index + offset
  if (index < 0 || next < 0 || next >= order.length) return
  ;[order[index], order[next]] = [order[next]!, order[index]!]
  updatePreferences({ destinationOrder: order })
}
</script>

<template>
  <ProductWorkbench
    v-if="activeDestination"
    :active-destination="activeDestination"
    :active-description="feature.state.description ?? ''"
    :navigation-items="items"
    :mobile-navigation-items="mobileItems"
    :active-mobile-navigation-id="feature.state.activeViewId"
    :preference-destinations="destinations"
    :hidden-destination-ids="preferences.hiddenDestinationIds"
    :sidebar-side="preferences.sidebarSide"
    :sidebar-collapsed="
      !mobileLayout &&
      (navigation?.state.effectiveSidebarCollapsed ?? preferences.isSidebarCollapsed)
    "
    :mobile-drawer-open="drawerOpen"
    :mobile-navigation-enabled="preferences.isMobileNavigationEnabled"
    :mobile-layout="mobileLayout"
    :preferences-open="preferencesOpen"
    :theme="preferences.theme"
    :resolved-theme="feature.state.resolvedTheme ?? 'light'"
    :product-hidden="feature.state.hidden"
    :can-hide-product="feature.state.canHide ?? false"
    :presentation="feature.state.presentation ?? 'embedded'"
    :modal-open="modalOpen"
    :player-modal-open="playerModalOpen"
    @select-navigation="navigate"
    @select-mobile-navigation="navigate"
    @close-mobile-drawer="drawerOpen = false"
    @toggle-mobile-drawer="drawerOpen = !drawerOpen"
    @open-global-settings="openSettings"
    @open-preferences="preferencesOpen = true"
    @close-preferences="preferencesOpen = false"
    @hide-product="feature.actions.hide"
    @show-product="feature.actions.show"
    @toggle-sidebar-collapsed="
      navigation?.actions.toggleSidebar
        ? navigation.actions.toggleSidebar()
        : updatePreferences({ isSidebarCollapsed: !preferences.isSidebarCollapsed })
    "
    @set-sidebar-side="updatePreferences({ sidebarSide: $event })"
    @set-theme="updatePreferences({ theme: $event })"
    @set-mobile-navigation-enabled="updatePreferences({ isMobileNavigationEnabled: $event })"
    @set-destination-visible="setVisible"
    @move-destination="moveDestination"
  >
    <slot />
    <template v-if="sidebarNavigation" #navigation
      ><ClassicNavigation :feature="sidebarNavigation" :form="mobileLayout ? 'mobile' : 'desktop'"
    /></template>
    <template v-if="$slots.source" #source><slot name="source" /></template>
    <template v-if="$slots.session" #session><slot name="session" /></template>
    <template #player><slot name="player" /></template>
    <template #overlays><slot name="overlays" /></template>
  </ProductWorkbench>
</template>
