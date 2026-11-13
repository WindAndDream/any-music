<script setup lang="ts">
import { computed, onMounted, shallowRef, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  css?: string
  theme?: 'light' | 'dark'
  overlayRoot?: HTMLElement | null
}>()
defineSlots<{ default(context: { overlayTarget: HTMLElement | null }): unknown }>()
const container = useTemplateRef<HTMLElement>('container')
const localOverlayTarget = useTemplateRef<HTMLElement>('localOverlayTarget')
const overlayContainer = useTemplateRef<HTMLElement>('overlayContainer')
const externalOverlayTarget = useTemplateRef<HTMLElement>('externalOverlayTarget')
const overlayTarget = computed(() => externalOverlayTarget.value ?? localOverlayTarget.value)
const surface = shallowRef<ShadowRoot>()
const overlaySurface = shallowRef<ShadowRoot>()
// Keep native detail dialogs outside suspended theme ancestors and theme styles.
onMounted(() => {
  surface.value = container.value!.attachShadow({ mode: 'open' })
})
watch(
  overlayContainer,
  (element) => {
    overlaySurface.value = element?.attachShadow({ mode: 'open' })
  },
  { flush: 'post' },
)
</script>

<template>
  <div ref="container" data-am-host-surface="slot">
    <Teleport v-if="surface" :to="surface">
      <component :is="'style'" v-if="css">{{ css }}</component>
      <div class="am-root" :data-am-theme="theme" style="pointer-events: auto">
        <slot :overlay-target="overlayTarget" />
        <div v-if="!props.overlayRoot" ref="localOverlayTarget" data-am-host-overlay-target />
      </div>
    </Teleport>
  </div>
  <Teleport v-if="props.overlayRoot" :to="props.overlayRoot">
    <div
      ref="overlayContainer"
      data-am-host-surface="slot-overlays"
      style="position: absolute; inset: 0; pointer-events: none"
    >
      <Teleport v-if="overlaySurface" :to="overlaySurface">
        <component :is="'style'" v-if="css">{{ css }}</component>
        <div class="am-root" :data-am-theme="theme">
          <div ref="externalOverlayTarget" data-am-host-overlay-target />
        </div>
      </Teleport>
    </div>
  </Teleport>
</template>
