<script setup lang="ts">
import { useId } from 'vue'

import AppIcon from './AppIcon.vue'

/** Controlled name form; callers own drafts, validation and persistence. */
const props = defineProps<{
  originalName: string
  originalLabel: string
  inputName: string
  placeholder: string
  helpText: string
  maxLength: number
  canSave: boolean
  error?: string
}>()
const draft = defineModel<string>({ required: true })
const emit = defineEmits<{ save: []; back: [] }>()
const inputId = useId()
const helpId = useId()
</script>

<template>
  <form class="name-editor" @submit.prevent="props.canSave && emit('save')">
    <label :for="inputId">自定义名称</label>
    <input
      :id="inputId"
      v-model="draft"
      :name="props.inputName"
      :maxlength="props.maxLength"
      :aria-describedby="helpId"
      :aria-invalid="Boolean(props.error)"
      autocomplete="off"
      :placeholder="props.placeholder"
    />
    <p :id="helpId" class="name-editor__help">{{ props.error || props.helpText }}</p>
    <dl class="name-editor__original">
      <dt>{{ props.originalLabel }}</dt>
      <dd>{{ props.originalName }}</dd>
    </dl>
    <div class="name-editor__actions">
      <button type="button" @click="emit('back')">
        <AppIcon name="arrow-left" :size="18" /> 返回
      </button>
      <button type="submit" :disabled="!props.canSave">保存名称</button>
    </div>
  </form>
</template>
<style scoped>
.name-editor {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-2);
}
.name-editor input,
.name-editor button {
  min-inline-size: 0;
  min-block-size: 44px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
}
.name-editor input:focus,
.name-editor button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.name-editor__help,
.name-editor__original {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.name-editor__original {
  display: grid;
  gap: var(--am-space-1);
  padding: var(--am-space-3);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface-subtle);
}
.name-editor__original dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.name-editor__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--am-space-2);
}
.name-editor button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  cursor: pointer;
}
.name-editor button:not(:disabled):hover {
  background: var(--am-color-surface-hover);
}
.name-editor button[type='submit'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
.name-editor button[type='submit']:not(:disabled):hover {
  background: var(--am-color-primary-hover);
}
.name-editor button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
