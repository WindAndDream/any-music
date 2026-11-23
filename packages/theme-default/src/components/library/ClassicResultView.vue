<script setup lang="ts">
import {
  BaseTransition,
  defineComponent,
  h,
  KeepAlive,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'

/** Slides in the new results while the toolbar stays mounted. */
const props = defineProps<{
  viewKey: string
  reverse?: boolean
  as?: 'div' | 'fieldset'
  retainTrackGrid?: boolean
}>()
const emit = defineEmits<{
  beforeLeave: [element: Element]
  beforeSwitch: [element: Element]
}>()
const slots = defineSlots<{ default?: () => unknown }>()

// Forward the slot itself so KeepAlive receives the grid component, rather than a slot fragment.
const RetainTrackGrid = defineComponent({
  setup: () => () => h(KeepAlive, { include: 'QueueTrackGrid' }, slots),
})

const retainedView = useTemplateRef<HTMLElement>('retainedView')
const retainedDirection = shallowRef<'back' | 'forward'>()
watch(
  () => props.viewKey,
  () => {
    const view = retainedView.value
    if (!view) return
    emit('beforeSwitch', view)
    retainedDirection.value = props.reverse ? 'back' : 'forward'
  },
)

function startEnter(element: Element): void {
  // Set the animation before insertion so the first paint starts the slide.
  element.setAttribute('data-classic-result-enter', props.reverse ? 'back' : 'forward')
}
</script>

<template>
  <div v-if="retainTrackGrid" ref="retainedView" :data-classic-result-enter="retainedDirection">
    <RetainTrackGrid />
  </div>
  <!-- With no leave animation, Vue removes the old view in the same patch. -->
  <BaseTransition v-else @before-enter="startEnter" @before-leave="emit('beforeLeave', $event)">
    <component :is="as ?? 'div'" :key="viewKey"><slot /></component>
  </BaseTransition>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  [data-classic-result-enter] {
    animation: classic-result-slide-forward var(--am-motion-normal) var(--am-ease-emphasized);
  }
  [data-classic-result-enter='back'] {
    animation-name: classic-result-slide-back;
  }
  @keyframes classic-result-slide-forward {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
  }
  @keyframes classic-result-slide-back {
    from {
      transform: translateX(-100%);
      opacity: 0;
    }
  }
}
</style>
