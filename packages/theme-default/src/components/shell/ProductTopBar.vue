<script setup lang="ts">
import { AppIcon } from '@any-music/ui'
import type { SidebarSide } from '@any-music/ui'

interface Props {
  title: string
  sidebarSide: SidebarSide
  mobileLayout: boolean
  isNavigationOpen: boolean
  canHideProduct?: boolean
}

withDefaults(defineProps<Props>(), {
  canHideProduct: false,
})

const emit = defineEmits<{
  toggleNavigation: []
  hideProduct: []
}>()

defineSlots<{
  source?: () => unknown
  session?: () => unknown
}>()
</script>

<template>
  <header
    class="product-top-bar"
    :class="{ 'product-top-bar--without-source': !$slots.source }"
    :data-mobile-layout="mobileLayout"
    :data-sidebar-side="mobileLayout ? sidebarSide : undefined"
  >
    <!-- The drawer exists only in the viewport-level mobile shell; container width alone is insufficient. -->
    <button
      v-if="mobileLayout"
      class="product-top-bar__menu"
      type="button"
      data-am-focus-key="navigation:open"
      :aria-expanded="isNavigationOpen"
      aria-controls="am-product-navigation"
      :aria-label="isNavigationOpen ? '关闭功能导航' : '打开功能导航'"
      @click="emit('toggleNavigation')"
    >
      <AppIcon name="menu" />
    </button>

    <div class="product-top-bar__copy">
      <h1 class="product-top-bar__title">{{ title }}</h1>
    </div>

    <div v-if="$slots.source" class="product-top-bar__source">
      <slot name="source" />
    </div>

    <div class="product-top-bar__actions">
      <slot name="session" />
      <button
        v-if="canHideProduct"
        type="button"
        aria-label="隐藏 Any Music"
        title="隐藏 Any Music"
        @click="emit('hideProduct')"
      >
        <AppIcon name="hide" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.product-top-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, 240px) auto;
  grid-template-areas: 'copy source actions';
  align-items: center;
  gap: var(--am-space-3);
  min-block-size: var(--am-size-top-bar);
  padding: var(--am-space-3) var(--am-space-5);
  border-block-end: 1px solid var(--am-color-border);
  background: var(--am-color-surface);
  backdrop-filter: blur(18px) saturate(135%);
}

@supports (background: color-mix(in srgb, white 50%, transparent)) {
  .product-top-bar {
    background: color-mix(in srgb, var(--am-color-surface) 92%, transparent);
  }
}

.product-top-bar__menu {
  grid-area: menu;
  display: none;
}

.product-top-bar__copy {
  grid-area: copy;
  min-inline-size: 0;
}

.product-top-bar__source {
  grid-area: source;
  min-inline-size: 0;
}
.product-top-bar__actions {
  grid-area: actions;
  min-inline-size: 0;
}

.product-top-bar__title {
  margin: 0;
  overflow: hidden;
  color: var(--am-color-text);
  font-size: var(--am-font-size-lg);
  letter-spacing: -0.025em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.product-top-bar__source,
.product-top-bar__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--am-space-2);
}

.product-top-bar__actions button,
.product-top-bar__menu {
  inline-size: var(--am-size-control);
  block-size: var(--am-size-control);
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text-secondary);
  cursor: pointer;
  transition:
    color var(--am-motion-fast) var(--am-ease-standard),
    background-color var(--am-motion-fast) var(--am-ease-standard),
    transform var(--am-motion-fast) var(--am-ease-standard);
}

@media (hover: hover) {
  .product-top-bar__actions button:hover,
  .product-top-bar__menu:hover {
    background: var(--am-color-hover);
    color: var(--am-color-primary);
  }
}

.product-top-bar__actions button:active,
.product-top-bar__menu:active {
  transform: scale(0.94);
}

/* 顶栏只读取自己的 Grid 轨道；窄桌面保留账号/隐藏操作，不切换成移动抽屉。 */
@container am-top-bar (max-width: 960px) {
  .product-top-bar {
    grid-template-columns: minmax(0, 1fr) minmax(0, 180px) auto;
    gap: var(--am-space-2);
    padding-inline: var(--am-space-3);
  }
}

@container am-top-bar (max-width: 720px) {
  .product-top-bar {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'copy copy' 'source actions';
  }

  .product-top-bar__source {
    justify-content: flex-start;
  }
}

/* 抽屉入口由运行端的视口模式决定，局部容器变窄只影响内容排版。 */
.product-top-bar[data-mobile-layout='true'] {
  grid-template-columns: 40px minmax(0, 1fr) minmax(0, auto);
  grid-template-areas: 'menu copy source';
  min-block-size: var(--am-size-mobile-top-bar);
  padding: max(var(--am-space-2), env(safe-area-inset-top)) var(--am-space-3) var(--am-space-2);
}

.product-top-bar[data-mobile-layout='true'][data-sidebar-side='right'] {
  grid-template-columns: minmax(0, 1fr) minmax(0, auto) 40px;
  grid-template-areas: 'copy source menu';
}

.product-top-bar[data-mobile-layout='true'] .product-top-bar__menu {
  display: grid;
}

.product-top-bar[data-mobile-layout='true'] .product-top-bar__actions {
  display: none;
}

.product-top-bar[data-mobile-layout='true'] .product-top-bar__source {
  justify-content: flex-end;
  justify-self: end;
  max-inline-size: min(42cqi, 180px);
}

.product-top-bar[data-mobile-layout='true']
  .product-top-bar__source
  :deep(.catalog-request-account) {
  /* 账号文字补齐导航图标在按钮内的留白，使两侧可见内容与边缘的距离协调。 */
  box-sizing: border-box;
  padding-inline-end: var(--am-space-3);
}

.product-top-bar[data-mobile-layout='true'] .product-top-bar__title {
  font-size: var(--am-font-size-md);
}

/* 无来源上下文的功能页释放平台轨道，移动端只保留导航与标题。 */
.product-top-bar--without-source {
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: 'copy actions';
}
.product-top-bar--without-source[data-mobile-layout='true'] {
  grid-template-columns: 40px minmax(0, 1fr);
  grid-template-areas: 'menu copy';
}

.product-top-bar--without-source[data-mobile-layout='true'][data-sidebar-side='right'] {
  grid-template-columns: minmax(0, 1fr) 40px;
  grid-template-areas: 'copy menu';
}

@media (prefers-reduced-motion: reduce) {
  .product-top-bar__actions button,
  .product-top-bar__menu {
    transition: none;
  }
}
</style>
