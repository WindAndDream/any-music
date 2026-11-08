<script setup lang="ts">
import { useId } from 'vue'

/** 范围属性保留输入语义，提交交由设置层校验并统一弹出结果。 */
const props = defineProps<{
  label: string
  description: string
  minimum: number
  maximum: number
  saveLabel: string
  errorMessage?: string
  focusKey?: string
}>()
const model = defineModel<number | string>({ required: true })
const emit = defineEmits<{ save: [] }>()
const formId = useId()
</script>

<template>
  <form class="settings-form" novalidate @submit.prevent="emit('save')">
    <div class="settings-form__card">
      <div class="settings-form__heading">
        <label :for="`${formId}-input`"
          ><strong>{{ props.label }}</strong></label
        >
        <p :id="`${formId}-hint`" class="settings-form__hint">{{ props.description }}</p>
      </div>
      <div class="settings-form__field">
        <input
          :id="`${formId}-input`"
          v-model.number="model"
          :data-am-focus-key="props.focusKey"
          type="number"
          :min="props.minimum"
          :max="props.maximum"
          step="1"
          inputmode="numeric"
          required
          :aria-invalid="props.errorMessage ? true : undefined"
          :aria-describedby="`${formId}-hint${props.errorMessage ? ` ${formId}-error` : ''}`"
        />
      </div>
      <p
        v-if="props.errorMessage"
        :id="`${formId}-error`"
        class="settings-form__error"
        role="alert"
      >
        {{ props.errorMessage }}
      </p>
      <div class="settings-form__footer">
        <button class="settings-form__save" type="submit">{{ props.saveLabel }}</button>
      </div>
    </div>
  </form>
</template>
