<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUpdated, useTemplateRef } from 'vue'

/** The slot supplies native buttons and their controlled pressed or selected state. */
defineSlots<{ default: () => unknown }>()

const group = useTemplateRef<HTMLElement>('group')
const indicator = useTemplateRef<HTMLElement>('indicator')
let buttons: HTMLElement[] = []
let observer: ResizeObserver | undefined
let selected: HTMLElement | undefined
let position = ''

function positionIndicator(): void {
  const root = group.value
  const slider = indicator.value
  if (!root || !slider) return

  const active = buttons.find(
    (button) =>
      button.getAttribute('aria-pressed') === 'true' ||
      button.getAttribute('aria-selected') === 'true',
  )
  const width = active?.offsetWidth
  const height = active?.offsetHeight
  if (!active || !width || !height) {
    slider.hidden = true
    root.removeAttribute('data-slider-positioned')
    selected = undefined
    position = ''
    return
  }

  // Layout offsets stay relative to the group even when a dialog or page is moving.
  const transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`
  const nextPosition = `${transform} ${width} ${height}`
  if (position !== nextPosition) {
    slider.setAttribute('data-slider-moving', String(Boolean(selected && selected !== active)))
    slider.style.transform = transform
    slider.style.width = `${width}px`
    slider.style.height = `${height}px`
    position = nextPosition
  }
  slider.hidden = false
  root.setAttribute('data-slider-positioned', '')
  selected = active
}

function updateButtons(): void {
  const root = group.value
  if (!root?.ownerDocument) return
  const next = Array.from(root.children).filter(
    (child): child is HTMLElement => child.tagName === 'BUTTON',
  )
  for (const button of buttons) {
    if (!next.includes(button)) observer?.unobserve(button)
  }
  for (const button of next) {
    if (!buttons.includes(button)) observer?.observe(button)
  }
  buttons = next
  positionIndicator()
}

onMounted(() => {
  const root = group.value
  if (!root?.ownerDocument) return
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(positionIndicator)
    observer.observe(root)
  } else {
    root.ownerDocument.defaultView?.addEventListener('resize', positionIndicator)
  }
  updateButtons()
})
onUpdated(updateButtons)
onBeforeUnmount(() => {
  observer?.disconnect()
  group.value?.ownerDocument?.defaultView?.removeEventListener('resize', positionIndicator)
  buttons = []
})
</script>

<template>
  <div ref="group" class="sliding-segments">
    <slot />
    <span ref="indicator" class="sliding-segments__indicator" aria-hidden="true" hidden />
  </div>
</template>

<style scoped>
.sliding-segments {
  position: relative;
  isolation: isolate;
}
.sliding-segments__indicator {
  position: absolute;
  z-index: -1;
  inset: 0 auto auto 0;
  border-radius: var(--am-radius-control);
  background: var(--am-segment-highlight, var(--am-color-primary-container));
  box-shadow: var(--am-segment-highlight-shadow, none);
  pointer-events: none;
}
@media (prefers-reduced-motion: no-preference) {
  .sliding-segments__indicator[data-slider-moving='true'] {
    transition:
      transform var(--am-motion-normal) var(--am-ease-standard),
      width var(--am-motion-normal) var(--am-ease-standard),
      height var(--am-motion-normal) var(--am-ease-standard);
  }
}
</style>
