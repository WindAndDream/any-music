<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { shallowRef, useTemplateRef, watch } from 'vue'

/** Collapse supporting copy only when its full line no longer fits beside the action. */
defineProps<{ title: string; description: string; canDelete: boolean; confirming: boolean }>()
defineEmits<{ help: []; delete: [] }>()
const descriptionElement = useTemplateRef<HTMLElement>('description')
const compact = shallowRef(false)
watch(
  descriptionElement,
  (target, _previous, onCleanup) => {
    const view = target?.ownerDocument?.defaultView
    if (!target || !view) return
    let active = true
    const measure = () => {
      if (active && target.clientWidth > 0) compact.value = target.scrollWidth > target.clientWidth
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(target)
    view.addEventListener('resize', measure)
    const fonts = target.ownerDocument.fonts
    fonts?.addEventListener('loadingdone', measure)
    onCleanup(() => {
      active = false
      observer?.disconnect()
      view.removeEventListener('resize', measure)
      fonts?.removeEventListener('loadingdone', measure)
    })
  },
  { flush: 'post' },
)
</script>

<template>
  <header class="tag-details-heading">
    <div class="tag-details-heading__copy">
      <div class="tag-details-heading__title">
        <h4 tabindex="-1" data-tag-detail-heading>{{ title }}</h4>
        <button
          v-if="compact"
          class="tag-details-heading__help"
          type="button"
          :aria-label="`${title}说明`"
          aria-haspopup="dialog"
          @click="$emit('help')"
        >
          <AppIcon name="warning" :size="18" />
        </button>
      </div>
      <p
        ref="description"
        class="tag-details-heading__description"
        :class="{ 'tag-details-heading__description--hidden': compact }"
        :aria-hidden="compact ? 'true' : undefined"
      >
        {{ description }}
      </p>
    </div>
    <button
      v-if="canDelete"
      class="tag-details-heading__delete"
      type="button"
      :disabled="confirming"
      @click="$emit('delete')"
    >
      <AppIcon name="trash" :size="18" />删除标签
    </button>
  </header>
</template>

<style scoped>
.tag-details-heading {
  display: flex;
  min-inline-size: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--am-space-3);
}
.tag-details-heading__copy {
  position: relative;
  flex: 1;
  min-inline-size: 0;
}
.tag-details-heading__title {
  display: flex;
  min-block-size: 44px;
  align-items: center;
  gap: var(--am-space-1);
}
.tag-details-heading__title h4 {
  flex: none;
  margin: 0;
}
.tag-details-heading__description {
  margin: 0;
  overflow: hidden;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  white-space: nowrap;
}
.tag-details-heading__description--hidden {
  /* Retain the available width for measurement, including when the dialog grows again. */
  position: absolute;
  inset-inline: 0;
  block-size: 0;
  visibility: hidden;
}
.tag-details-heading .tag-details-heading__help {
  display: grid;
  flex: none;
  inline-size: 44px;
  block-size: 44px;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--am-color-text-secondary);
}
.tag-details-heading .tag-details-heading__delete {
  display: inline-flex;
  flex: none;
  min-block-size: 44px;
  align-items: center;
  gap: var(--am-space-2);
  color: var(--am-color-danger);
  font-weight: 400;
  white-space: nowrap;
}
</style>
