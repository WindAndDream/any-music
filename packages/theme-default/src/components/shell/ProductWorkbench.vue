<script setup lang="ts">
import {
  AppIcon,
  BottomSheet,
  MobileBottomNavigation,
  MusicAppShell,
  NavigationRail,
} from '@any-music/ui'
import type { AppIconName, AppShellPreferenceKind } from '@any-music/ui'
import type { UiWorkbenchShellProps, UiWorkbenchShellEmits } from '@any-music/ui/theme'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

import AppShellPreferenceDialog from '../settings/AppShellPreferenceDialog.vue'
import AppShellPreferencesPanel from '../settings/AppShellPreferencesPanel.vue'
import ProductTopBar from './ProductTopBar.vue'

const props = withDefaults(defineProps<UiWorkbenchShellProps>(), {
  modalOpen: false,
  playerModalOpen: false,
  hasPlayer: true,
  productHidden: false,
  canHideProduct: false,
  presentation: 'embedded',
  brandTitle: 'Any Music',
  brandDescription: '跨来源音乐工作台',
})

const emit = defineEmits<UiWorkbenchShellEmits>()

defineSlots<{
  source?: () => unknown
  session?: () => unknown
  default?: () => unknown
  player?: () => unknown
  overlays?: () => unknown
  'root-overlay'?: () => unknown
  navigation?: () => unknown
}>()

const productReopenButton = useTemplateRef<HTMLButtonElement>('productReopenButton')
const isShellModalOpen = computed(() => props.modalOpen || props.preferencesOpen)
const preferenceSetting = shallowRef<AppShellPreferenceKind | null>(null)

// 子弹窗属于临时展示状态；关闭整个设置后重新打开时必须回到设置列表。
watch(
  () => props.preferencesOpen,
  (isOpen) => {
    if (!isOpen) preferenceSetting.value = null
  },
)
const sidebarToggleIcon = computed<AppIconName>(() => {
  if (props.sidebarSide === 'right') {
    return props.sidebarCollapsed ? 'arrow-left' : 'arrow-right'
  }
  return props.sidebarCollapsed ? 'arrow-right' : 'arrow-left'
})
const sidebarToggleLabel = computed(() => {
  // 移动端显示的是完整抽屉，不应暴露只对桌面持久偏好生效的“展开侧栏”状态。
  if (props.mobileLayout) return '收起侧栏'
  return props.sidebarCollapsed ? '展开侧栏' : '收起侧栏'
})

let productHideTrigger: HTMLElement | undefined

/** Traverse Shadow roots so the shared shell can restore the actual control that hid the product. */
function getDeepActiveElement(): HTMLElement | undefined {
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') return undefined
  let activeElement: Element | null = document.activeElement
  while (activeElement instanceof HTMLElement && activeElement.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement
  }
  return activeElement instanceof HTMLElement ? activeElement : undefined
}

function requestHideProduct(): void {
  productHideTrigger = getDeepActiveElement()
  emit('hideProduct')
  void nextTick(() => productReopenButton.value?.focus({ preventScroll: true }))
}

function requestShowProduct(): void {
  emit('showProduct')
  void nextTick(() => {
    productHideTrigger?.focus({ preventScroll: true })
    productHideTrigger = undefined
  })
}
</script>

<template>
  <section
    class="product-workbench am-theme-default"
    :class="`product-workbench--${props.presentation}`"
    :data-am-theme="props.resolvedTheme"
  >
    <Transition name="am-launcher">
      <button
        v-if="props.canHideProduct && props.productHidden"
        ref="productReopenButton"
        class="product-reopen"
        type="button"
        :aria-label="`显示 ${props.brandTitle}`"
        :title="`显示 ${props.brandTitle}`"
        @click="requestShowProduct"
      >
        <AppIcon name="music" :size="24" />
      </button>
    </Transition>

    <MusicAppShell
      v-show="!props.productHidden"
      :presentation="props.presentation"
      :sidebar-side="props.sidebarSide"
      :sidebar-collapsed="props.sidebarCollapsed"
      :mobile-drawer-open="props.mobileDrawerOpen"
      :mobile-layout="props.mobileLayout"
      :modal-open="isShellModalOpen"
      :player-modal-open="props.playerModalOpen"
      :has-player="props.hasPlayer"
      :has-mobile-navigation="props.mobileNavigationEnabled"
      @close-mobile-drawer="emit('closeMobileDrawer')"
    >
      <template #sidebar>
        <div class="product-sidebar">
          <div class="product-sidebar__brand">
            <span class="product-sidebar__mark"><AppIcon name="music" :size="22" /></span>
            <!-- 保留文字节点和图标列，开合时只淡出文字，避免布局重建导致跳动。 -->
            <span class="product-sidebar__brand-copy" :aria-hidden="props.sidebarCollapsed">
              <strong>{{ props.brandTitle }}</strong>
              <small>{{ props.brandDescription }}</small>
            </span>
          </div>

          <slot name="navigation">
            <NavigationRail
              :items="props.navigationItems"
              :active-id="props.activeDestination.id"
              :collapsed="props.sidebarCollapsed"
              @select="emit('selectNavigation', $event)"
            />
          </slot>

          <div class="product-sidebar__footer">
            <button
              type="button"
              :aria-label="props.sidebarCollapsed ? '打开全局设置' : undefined"
              title="全局设置"
              data-am-focus-key="settings:open"
              @click="emit('openGlobalSettings')"
            >
              <AppIcon name="settings" />
              <span :aria-hidden="props.sidebarCollapsed">设置</span>
            </button>
            <button
              type="button"
              :aria-label="sidebarToggleLabel"
              :title="sidebarToggleLabel"
              :aria-expanded="!props.sidebarCollapsed"
              aria-controls="am-product-navigation"
              @click="emit('toggleSidebarCollapsed')"
            >
              <AppIcon :name="sidebarToggleIcon" />
              <span :aria-hidden="props.sidebarCollapsed">{{ sidebarToggleLabel }}</span>
            </button>
            <button
              v-if="props.canHideProduct"
              type="button"
              :aria-label="props.sidebarCollapsed ? `隐藏 ${props.brandTitle}` : undefined"
              :title="`隐藏 ${props.brandTitle}`"
              @click="requestHideProduct"
            >
              <AppIcon name="hide" />
              <span :aria-hidden="props.sidebarCollapsed">隐藏 {{ props.brandTitle }}</span>
            </button>
          </div>
        </div>
      </template>

      <template #header>
        <ProductTopBar
          :title="props.activeDestination.label"
          :sidebar-side="props.sidebarSide"
          :mobile-layout="props.mobileLayout"
          :is-navigation-open="props.mobileDrawerOpen"
          :can-hide-product="props.canHideProduct"
          @toggle-navigation="emit('toggleMobileDrawer')"
          @hide-product="requestHideProduct"
        >
          <template v-if="$slots.source" #source><slot name="source" /></template>
          <template v-if="$slots.session" #session><slot name="session" /></template>
        </ProductTopBar>
      </template>

      <div class="am-workspace-surface">
        <slot />
      </div>

      <template #player><slot name="player" /></template>

      <template v-if="props.mobileNavigationEnabled" #mobileNavigation>
        <MobileBottomNavigation
          :items="props.mobileNavigationItems"
          :active-id="props.activeMobileNavigationId"
          @select="emit('selectMobileNavigation', $event)"
        />
      </template>

      <template #overlays>
        <BottomSheet
          :open="props.preferencesOpen"
          :suspended="props.modalOpen || preferenceSetting !== null"
          title="自定义界面"
          description="主题、侧栏位置与导航顺序由当前运行端持久化。"
          size="content"
          @close="emit('closePreferences')"
        >
          <AppShellPreferencesPanel
            :destinations="props.preferenceDestinations"
            :hidden-destination-ids="props.hiddenDestinationIds"
            :sidebar-side="props.sidebarSide"
            :theme="props.theme"
            :is-mobile-navigation-enabled="props.mobileNavigationEnabled"
            :is-mobile-layout="props.mobileLayout"
            @open-preference-selection="preferenceSetting = $event"
            @set-mobile-navigation-enabled="emit('setMobileNavigationEnabled', $event)"
            @set-destination-visible="
              (id, isVisible) => emit('setDestinationVisible', id, isVisible)
            "
            @move-destination="(id, offset) => emit('moveDestination', id, offset)"
          />
        </BottomSheet>
        <!-- 弹窗与底部面板并列，避免被面板的滚动/裁切容器限制覆盖范围。 -->
        <AppShellPreferenceDialog
          :setting="preferenceSetting"
          :sidebar-side="props.sidebarSide"
          :theme="props.theme"
          :suspended="props.modalOpen"
          @close="preferenceSetting = null"
          @set-sidebar-side="emit('setSidebarSide', $event)"
          @set-theme="emit('setTheme', $event)"
        />
        <slot name="overlays" />
      </template>
    </MusicAppShell>

    <slot name="root-overlay" />
  </section>
</template>

<style scoped>
.am-workspace-surface {
  display: contents;
}
</style>
