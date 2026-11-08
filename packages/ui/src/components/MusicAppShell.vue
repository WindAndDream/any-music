<script setup lang="ts">
import { nextTick, shallowRef, useTemplateRef, watch } from 'vue'

import { useBackHandler } from '../composables/use-back-navigation'
import { useOverlayKeyboard } from '../composables/use-overlay-keyboard'
interface Props {
  /** Userscript overlays the host page; desktop and mobile webviews embed the same shell in a root. */
  presentation?: 'overlay' | 'embedded'
  sidebarSide?: 'left' | 'right'
  sidebarCollapsed?: boolean
  mobileDrawerOpen?: boolean
  /** 顶层运行时提供窄屏判定，使已关闭的抽屉从辅助技术导航树中退出。 */
  mobileLayout?: boolean
  /** 业务弹层打开时让壳层内容失焦，overlays 插槽本身仍保持可交互。 */
  modalOpen?: boolean
  /** 播放器自身承载模态详情时只暂停其他区域，不能把 player 插槽一起 inert。 */
  playerModalOpen?: boolean
  hasPlayer?: boolean
  hasMobileNavigation?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  presentation: 'overlay',
  sidebarSide: 'left',
  sidebarCollapsed: false,
  mobileDrawerOpen: false,
  mobileLayout: false,
  modalOpen: false,
  playerModalOpen: false,
  hasPlayer: true,
  hasMobileNavigation: true,
})

const emit = defineEmits<{
  closeMobileDrawer: []
}>()
useBackHandler({
  active: () => props.mobileLayout && props.mobileDrawerOpen && !props.modalOpen,
  layer: 'drawer',
  handle: () => emit('closeMobileDrawer'),
})

const sidebar = useTemplateRef<HTMLElement>('sidebar')
const mobileNavigation = useTemplateRef<HTMLElement>('mobileNavigation')
const previousFocus = shallowRef<HTMLElement>()
const mobileNavigationHeight = shallowRef(0)
const isMobileDrawerTransitioning = shallowRef(false)
const isSidebarTransitioning = shallowRef(false)

watch(
  [() => props.mobileLayout, () => props.sidebarCollapsed, () => props.sidebarSide],
  ([isMobile, isCollapsed, side], [wasMobile, wasCollapsed, previousSide]) => {
    // Only animate rail toggles; changing sides or entering the drawer layout must settle immediately.
    isSidebarTransitioning.value =
      !isMobile && !wasMobile && side === previousSide && isCollapsed !== wasCollapsed
  },
)

watch(
  [() => props.mobileLayout, () => props.mobileDrawerOpen, () => props.sidebarSide],
  ([isMobile, isOpen, side], [wasMobile, wasOpen, previousSide]) => {
    // 断点切换会把桌面侧栏重排成宽抽屉；只为同一移动布局内的主动开合启用退场延迟。
    isMobileDrawerTransitioning.value =
      isMobile && wasMobile && side === previousSide && isOpen !== wasOpen
  },
)

function handleSidebarTransitionEnd(event: TransitionEvent): void {
  // 内部文字过渡也会冒泡，且淡出早于滑动结束；不能提前隐藏仍在退场的抽屉。
  if (event.target === event.currentTarget && event.propertyName === 'transform') {
    isMobileDrawerTransitioning.value = false
  }
}

watch(
  mobileNavigation,
  (element, _, onCleanup) => {
    if (!element || typeof ResizeObserver === 'undefined') return
    // 底栏安全区可让实际高度超过 token；操作条须跟随真实高度完整覆盖它。
    const observer = new ResizeObserver(() => {
      mobileNavigationHeight.value = element.offsetHeight
    })
    observer.observe(element)
    onCleanup(() => {
      observer.disconnect()
      mobileNavigationHeight.value = 0
    })
  },
  { flush: 'post' },
)

watch(
  () => props.mobileDrawerOpen,
  async (isOpen) => {
    if (!isOpen) {
      // 关闭补丁会同时移除顶部栏的 inert；过早聚焦会被浏览器静默拒绝。
      await nextTick()
      if (previousFocus.value?.isConnected) previousFocus.value.focus({ preventScroll: true })
      previousFocus.value = undefined
      return
    }
    const root = sidebar.value?.getRootNode()
    previousFocus.value =
      root instanceof ShadowRoot && root.activeElement instanceof HTMLElement
        ? root.activeElement
        : undefined
    await nextTick()
    sidebar.value?.querySelector<HTMLElement>('button:not([disabled]), a[href]')?.focus({
      preventScroll: true,
    })
  },
)

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !sidebar.value) return

  // 移动导航声明为模态对话框时，键盘焦点也必须留在抽屉中，不能落到被遮罩的产品内容。
  const focusable = [
    ...sidebar.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ]
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) {
    event.preventDefault()
    sidebar.value.focus()
    return
  }
  const root = sidebar.value.getRootNode()
  const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

useOverlayKeyboard({
  active: () =>
    props.mobileLayout && props.mobileDrawerOpen && !props.modalOpen && !props.playerModalOpen,
  layer: 'drawer',
  onEscape: () => emit('closeMobileDrawer'),
  onTab: handleKeydown,
})

defineSlots<{
  sidebar?: () => unknown
  header?: () => unknown
  default?: () => unknown
  player?: () => unknown
  mobileNavigation?: () => unknown
  overlays?: () => unknown
}>()
</script>

<template>
  <section
    class="music-app-shell"
    :class="{
      'music-app-shell--overlay': props.presentation === 'overlay',
      'music-app-shell--embedded': props.presentation === 'embedded',
      'music-app-shell--sidebar-collapsed': props.sidebarCollapsed,
      'music-app-shell--sidebar-transition': isSidebarTransitioning,
      'music-app-shell--mobile-drawer-open': props.mobileDrawerOpen,
      'music-app-shell--mobile-drawer-transition': isMobileDrawerTransitioning,
      'music-app-shell--without-player': !props.hasPlayer,
      'music-app-shell--without-mobile-navigation': !props.hasMobileNavigation,
    }"
    :data-sidebar-side="props.sidebarSide"
    :style="
      mobileNavigationHeight
        ? { '--am-shell-mobile-navigation-offset': `${mobileNavigationHeight}px` }
        : undefined
    "
    @transitionend.self="isSidebarTransitioning = false"
  >
    <button
      v-if="props.mobileDrawerOpen"
      class="music-app-shell__scrim"
      type="button"
      aria-label="关闭功能导航"
      @click="emit('closeMobileDrawer')"
    ></button>
    <aside
      id="am-product-navigation"
      ref="sidebar"
      class="music-app-shell__sidebar"
      :role="props.mobileDrawerOpen ? 'dialog' : undefined"
      :aria-modal="props.mobileDrawerOpen ? 'true' : undefined"
      :aria-label="props.mobileDrawerOpen ? '功能导航' : undefined"
      :aria-hidden="props.mobileLayout && !props.mobileDrawerOpen ? 'true' : undefined"
      :tabindex="props.mobileDrawerOpen ? -1 : undefined"
      :inert="
        props.modalOpen || props.playerModalOpen || (props.mobileLayout && !props.mobileDrawerOpen)
          ? true
          : undefined
      "
      @transitionend="handleSidebarTransitionEnd"
    >
      <slot name="sidebar" />
    </aside>
    <div
      class="music-app-shell__header"
      :inert="props.mobileDrawerOpen || props.modalOpen || props.playerModalOpen ? true : undefined"
    >
      <slot name="header" />
    </div>
    <main
      class="music-app-shell__content"
      data-am-scroll-key="workspace"
      :inert="props.mobileDrawerOpen || props.modalOpen || props.playerModalOpen ? true : undefined"
    >
      <slot />
    </main>
    <div
      v-if="props.hasPlayer"
      class="music-app-shell__player"
      :inert="props.mobileDrawerOpen || props.modalOpen ? true : undefined"
    >
      <slot name="player" />
    </div>
    <div
      v-if="props.hasMobileNavigation"
      ref="mobileNavigation"
      class="music-app-shell__mobile-navigation"
      :inert="props.mobileDrawerOpen || props.modalOpen || props.playerModalOpen ? true : undefined"
    >
      <slot name="mobileNavigation" />
    </div>
    <div class="music-app-shell__overlays">
      <slot name="overlays" />
    </div>
  </section>
</template>

<style scoped>
.music-app-shell {
  --am-shell-mobile-navigation-offset: 0px;
  container: am-shell / inline-size;
  position: absolute;
  inset: 0;
  display: grid;
  grid-template:
    'sidebar header' auto
    'sidebar content' minmax(0, 1fr)
    'sidebar player' auto
    / var(--am-size-sidebar) minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-overlay);
  background: var(--am-color-background);
  box-shadow: var(--am-shadow-overlay);
  color: var(--am-color-text);
  isolation: isolate;
}

.music-app-shell--sidebar-transition {
  /* Animate the shared track so the rail, header, content and player keep the same moving edge. */
  transition: grid-template-columns var(--am-motion-normal) var(--am-ease-emphasized);
}

.music-app-shell--overlay {
  position: fixed;
  inset: var(--am-space-3);
}

.music-app-shell--embedded {
  border: 0;
  border-radius: 0;
}

.music-app-shell[data-sidebar-side='right'] {
  grid-template:
    'header sidebar' auto
    'content sidebar' minmax(0, 1fr)
    'player sidebar' auto
    / minmax(0, 1fr) var(--am-size-sidebar);
}

.music-app-shell--sidebar-collapsed {
  --am-size-sidebar: var(--am-size-sidebar-collapsed);
}

.music-app-shell__sidebar {
  /* 系统导航始终盖过非模态批量操作条，仍低于筛选器和确认框。 */
  z-index: var(--am-z-drawer);
  grid-area: sidebar;
  min-inline-size: 0;
  overflow: hidden;
  border-inline-end: 1px solid var(--am-color-border);
  background: var(--am-color-surface);
}

.music-app-shell[data-sidebar-side='right'] .music-app-shell__sidebar {
  border-inline-start: 1px solid var(--am-color-border);
  border-inline-end: 0;
}

.music-app-shell__header {
  container: am-top-bar / inline-size;
  z-index: var(--am-z-sticky);
  grid-area: header;
  min-inline-size: 0;
}

.music-app-shell__content {
  container: am-content / inline-size;
  display: flex;
  flex-direction: column;
  grid-area: content;
  min-inline-size: 0;
  min-block-size: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scroll-padding-block-end: var(--am-space-6);
}

.music-app-shell__player {
  /* 播放器按实际可用宽度收敛布局，避免侧栏占位后仍误用视口级桌面排版。 */
  container: am-player / inline-size;
  z-index: var(--am-z-player);
  grid-area: player;
  min-inline-size: 0;
}

.music-app-shell__mobile-navigation {
  display: none;
}

.music-app-shell__overlays {
  display: contents;
}

.music-app-shell__scrim {
  display: none;
}

@supports (height: 100dvh) {
  .music-app-shell--overlay {
    block-size: calc(100dvh - 2 * var(--am-space-3));
  }
}

/* 桌面宽度只由受控收起状态决定；媒体查询仅负责切换移动抽屉布局。 */
@media (max-width: 768px) {
  .music-app-shell,
  .music-app-shell[data-sidebar-side='right'] {
    --am-shell-mobile-navigation-offset: var(--am-mobile-navigation-height);
    inset: 0;
    block-size: 100vh;
    block-size: 100dvh;
    grid-template:
      'header' auto
      'content' minmax(0, 1fr)
      'player' auto
      'mobile-navigation' auto
      / minmax(0, 1fr);
    border: 0;
    border-radius: 0;
    transition: none;
  }

  .music-app-shell--without-player,
  .music-app-shell--without-player[data-sidebar-side='right'] {
    grid-template-rows: auto minmax(0, 1fr) 0 auto;
  }

  .music-app-shell--without-mobile-navigation,
  .music-app-shell--without-mobile-navigation[data-sidebar-side='right'] {
    --am-shell-mobile-navigation-offset: 0px;
    grid-template-rows: auto minmax(0, 1fr) auto 0;
  }

  .music-app-shell__sidebar {
    position: absolute;
    z-index: var(--am-z-drawer);
    inset-block: 0;
    inset-inline-start: 0;
    inline-size: min(304px, 86cqi);
    border: 0;
    border-inline-end: 1px solid var(--am-color-border);
    box-shadow: var(--am-shadow-overlay);
    opacity: 0;
    pointer-events: none;
    overscroll-behavior: contain;
    transform: translateX(-100%);
    visibility: hidden;
    transition: none;
  }

  .music-app-shell--mobile-drawer-transition .music-app-shell__sidebar {
    transition:
      transform var(--am-motion-slow) var(--am-ease-emphasized),
      opacity var(--am-motion-normal) var(--am-ease-standard),
      visibility 0s linear var(--am-motion-slow);
  }

  .music-app-shell[data-sidebar-side='right'] .music-app-shell__sidebar {
    inset-inline: auto 0;
    border-inline-start: 1px solid var(--am-color-border);
    border-inline-end: 0;
    transform: translateX(100%);
  }

  /* 与右侧定位规则保持相同优先级，确保左右抽屉打开后都能回到原点。 */
  .music-app-shell.music-app-shell--mobile-drawer-open .music-app-shell__sidebar {
    opacity: 1;
    pointer-events: auto;
    transform: translateX(0);
    visibility: visible;
    transition-delay: 0s;
  }

  .music-app-shell__scrim {
    position: absolute;
    z-index: calc(var(--am-z-drawer) - 1);
    inset: 0;
    display: block;
    padding: 0;
    border: 0;
    background: var(--am-color-scrim);
    backdrop-filter: blur(2px);
  }

  .music-app-shell__mobile-navigation {
    z-index: var(--am-z-navigation);
    grid-area: mobile-navigation;
    display: block;
  }
}

@media (prefers-reduced-motion: reduce) {
  .music-app-shell--sidebar-transition,
  .music-app-shell--mobile-drawer-transition .music-app-shell__sidebar {
    transition: none;
  }
}
</style>
