<script setup lang="ts">
import { useId } from 'vue'

/** Host-owned plugin settings keep content and actions inside the same surface. */
defineProps<{ title: string; description?: string }>()
defineSlots<{ default: () => unknown; actions?: () => unknown }>()
const sectionId = useId()
</script>

<template>
  <section class="settings-form plugin-settings-section" :aria-labelledby="sectionId">
    <div class="settings-form__card">
      <header class="settings-form__heading">
        <div class="plugin-settings-section__copy">
          <h4 :id="sectionId">{{ title }}</h4>
          <p v-if="description" class="settings-form__hint">{{ description }}</p>
        </div>
      </header>
      <div class="plugin-settings-section__content"><slot /></div>
      <div v-if="$slots.actions" class="settings-form__footer"><slot name="actions" /></div>
    </div>
  </section>
</template>

<style scoped>
.plugin-settings-section__copy {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-1);
}
.plugin-settings-section__copy h4 {
  margin: 0;
  font-size: var(--am-font-size-sm);
  line-height: 1.6;
}
.plugin-settings-section__content {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-4);
}
</style>
