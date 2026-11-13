<script setup lang="ts">
import type { UiThemeFeatureMap, UiThemeForm, UiThemeHostSlots } from '@any-music/ui/theme'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import type { CSSProperties } from 'vue'

import type { ThemeSnapshot } from './theme-contracts'
import ThemeHostSurface from './ThemeHostSurface.vue'
import ThemeRootBoundary from './ThemeRootBoundary.vue'

const props = defineProps<{
  snapshot: ThemeSnapshot
  features: Readonly<UiThemeFeatureMap>
  form: UiThemeForm
  needsRecovery: boolean
  protectedCss?: string
}>()
const emit = defineEmits<{ failure: [generation: number, error: unknown] }>()
defineSlots<UiThemeHostSlots & { recovery(): unknown; protected(): unknown }>()
const container = useTemplateRef<HTMLElement>('container')
const presentation = useTemplateRef<HTMLElement>('presentation')
const protectedOverlays = useTemplateRef<HTMLElement>('protectedOverlays')
const surface = shallowRef<ShadowRoot>()
// Recovery must remain usable even when no theme stylesheet or presentation can render.
const recoveryStyle = computed<CSSProperties>(() => ({
  display: 'block',
  inlineSize: '100%',
  blockSize: '100%',
  minInlineSize: '0',
  minBlockSize: '0',
  boxSizing: 'border-box',
  backgroundColor: `var(--am-color-background, ${props.features.shell.state.resolvedTheme === 'dark' ? '#121116' : '#f7f6f2'})`,
  overflow: 'auto',
  pointerEvents: 'auto',
  ...(props.features.shell.state.presentation === 'embedded'
    ? { position: 'relative' }
    : { position: 'fixed', inset: '0', zIndex: 100 }),
}))
function deactivateOutgoingRoot() {
  if (presentation.value) presentation.value.inert = true
}
watch(() => props.snapshot.generation, deactivateOutgoingRoot, { flush: 'sync' })
watch(
  () => props.needsRecovery,
  async (needsRecovery, wasRecovery, onCleanup) => {
    if (needsRecovery || !wasRecovery) return
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    // The root and protected dialogs mount through nested Teleports after recovery leaves.
    await nextTick()
    await nextTick()
    if (cancelled || props.needsRecovery || !presentation.value) return
    const active = surface.value?.activeElement
    if (
      typeof HTMLElement !== 'undefined' &&
      active instanceof HTMLElement &&
      presentation.value.contains(active) &&
      !active.closest('[inert], [hidden], [aria-hidden="true"]') &&
      active.getClientRects().length > 0
    ) {
      const visibility = active.ownerDocument.defaultView?.getComputedStyle(active).visibility
      if (visibility !== 'hidden' && visibility !== 'collapse') return
    }
    presentation.value.focus({ preventScroll: true })
  },
  { flush: 'post' },
)
onBeforeUnmount(deactivateOutgoingRoot)
// Styles and the replaceable root share one stable Shadow tree; safety UI is a sibling.
onMounted(() => {
  try {
    surface.value = container.value!.attachShadow({ mode: 'open' })
  } catch (error) {
    emit('failure', props.snapshot.generation, error)
  }
})
defineExpose({ getResourceRoot: () => surface.value })
</script>

<template>
  <div data-am-theme-host>
    <div
      v-show="!props.needsRecovery"
      ref="container"
      :inert="props.needsRecovery ? true : undefined"
    />
    <Teleport v-if="surface && props.snapshot.generation > 0" :to="surface">
      <ThemeRootBoundary
        v-if="!props.needsRecovery"
        :key="props.snapshot.generation"
        :generation="props.snapshot.generation"
        @failure="(generation, error) => emit('failure', generation, error)"
      >
        <div
          ref="presentation"
          class="am-root"
          :data-am-theme="props.features.shell.state.resolvedTheme"
          :data-am-ui-theme="props.snapshot.theme.definition.id"
          :data-am-ui-density="props.snapshot.settings.density"
          data-am-theme-root
          data-am-focus-fallback
          tabindex="-1"
        >
          <component
            :is="props.snapshot.theme.definition.Root"
            :features="props.features"
            :views="props.snapshot.theme.definition.views"
            :form="props.form"
          >
            <template v-if="$slots['account-settings']" #account-settings="context"
              ><ThemeHostSurface
                v-slot="{ overlayTarget }"
                :overlay-root="protectedOverlays"
                :css="props.protectedCss"
                :theme="props.features.shell.state.resolvedTheme"
                ><slot
                  name="account-settings"
                  v-bind="{ ...context, overlayTarget }" /></ThemeHostSurface
            ></template>
            <template v-if="$slots['network-settings']" #network-settings
              ><ThemeHostSurface
                :css="props.protectedCss"
                :theme="props.features.shell.state.resolvedTheme"
                ><slot name="network-settings" /></ThemeHostSurface
            ></template>
            <template v-if="$slots['download-settings']" #download-settings
              ><ThemeHostSurface
                :css="props.protectedCss"
                :theme="props.features.shell.state.resolvedTheme"
                ><slot name="download-settings" /></ThemeHostSurface
            ></template>
            <template v-if="$slots['cache-settings']" #cache-settings="context"
              ><ThemeHostSurface
                v-slot="{ overlayTarget }"
                :overlay-root="protectedOverlays"
                :css="props.protectedCss"
                :theme="props.features.shell.state.resolvedTheme"
                ><slot
                  name="cache-settings"
                  v-bind="{ ...context, overlayTarget }" /></ThemeHostSurface
            ></template>
            <template v-if="$slots['external-source-settings']" #external-source-settings
              ><ThemeHostSurface
                :css="props.protectedCss"
                :theme="props.features.shell.state.resolvedTheme"
                ><slot name="external-source-settings" /></ThemeHostSurface
            ></template>
            <template v-if="$slots['source-identity']" #source-identity="context"
              ><ThemeHostSurface
                :css="props.protectedCss"
                :theme="props.features.shell.state.resolvedTheme"
                ><slot name="source-identity" v-bind="context" /></ThemeHostSurface
            ></template>
            <template v-if="$slots['request-account']" #request-account="context"
              ><ThemeHostSurface
                :css="props.protectedCss"
                :theme="props.features.shell.state.resolvedTheme"
                ><slot name="request-account" v-bind="context" /></ThemeHostSurface
            ></template>
          </component>
        </div>
      </ThemeRootBoundary>
    </Teleport>
    <div
      ref="protectedOverlays"
      data-am-host-overlay-root
      style="position: fixed; inset: 0; pointer-events: none; z-index: 90"
    ></div>
    <div data-am-host-surface="protected"><slot name="protected" /></div>
    <div
      v-if="props.needsRecovery"
      role="alert"
      data-am-host-surface="theme-recovery"
      :style="recoveryStyle"
    >
      <slot name="recovery" />
    </div>
  </div>
</template>

<style scoped>
[data-am-theme-host],
[data-am-theme-host] > div:first-child,
[data-am-theme-root] {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  min-block-size: 0;
}
</style>
