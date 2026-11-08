<script setup lang="ts">
import { useId } from 'vue'

defineProps<{
  title: string
  minimum: number
  maximum: number
  disabled: boolean
  focusKey: string
  hint?: string
}>()
const capacityMib = defineModel<string>({ required: true })
const emit = defineEmits<{ save: [] }>()
defineSlots<{
  default?: () => unknown
  'header-actions'?: () => unknown
  actions?: () => unknown
}>()
const id = useId()
</script>

<template>
  <section class="settings-form__card" :aria-labelledby="`${id}-title`">
    <div class="settings-form__heading resource-cache-capacity__heading">
      <h4 :id="`${id}-title`">{{ title }}</h4>
      <slot name="header-actions" />
    </div>
    <slot />
    <form class="resource-cache-capacity" novalidate @submit.prevent="emit('save')">
      <label class="settings-form__field">
        <span class="settings-form__heading"
          ><strong>{{ title }}上限（MiB）</strong
          ><small v-if="hint" :id="`${id}-hint`" class="settings-form__hint">{{
            hint
          }}</small></span
        >
        <input
          :value="capacityMib"
          type="number"
          inputmode="numeric"
          :min="minimum"
          :max="maximum"
          step="1"
          required
          :disabled="disabled"
          :aria-describedby="hint ? `${id}-hint` : undefined"
          :data-am-focus-key="focusKey"
          @input="capacityMib = ($event.target as HTMLInputElement).value"
        />
      </label>
      <div class="settings-form__footer">
        <slot name="actions" />
        <button
          class="settings-form__save"
          type="submit"
          :disabled="disabled"
          :aria-label="`保存${title}上限`"
        >
          保存上限
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.resource-cache-capacity {
  display: grid;
  gap: var(--am-space-2);
}
.resource-cache-capacity__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-3);
}
</style>
