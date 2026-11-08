<script setup lang="ts" generic="T extends string, Multiple extends boolean = false">
import { useId } from 'vue'

defineProps<{
  label: string
  options: readonly { value: T; label: string; description: string }[]
  // Keep Boolean attribute casting while inferring the model type from this mode.
  multiple?: Multiple & boolean
  allOption?: { label: string; description: string }
}>()
type Selection = Multiple extends true ? readonly T[] : T
const model = defineModel<Selection>({ required: true })
const groupId = useId()
function isChecked(value: T): boolean {
  const selected: T | readonly T[] = model.value
  return typeof selected === 'string' ? selected === value : selected.includes(value)
}
function select(value: T) {
  const selected: T | readonly T[] = model.value
  setSelection(
    typeof selected === 'string'
      ? value
      : selected.includes(value)
        ? selected.filter((candidate) => candidate !== value)
        : [...selected, value],
  )
}
function setSelection(value: T | readonly T[]) {
  model.value = value as Selection
}
</script>

<template>
  <fieldset class="collection-filter-choices">
    <legend class="am-sr-only">{{ label }}</legend>
    <label v-if="multiple && allOption" class="collection-filter-choices__option">
      <input
        type="radio"
        :name="groupId"
        value="all"
        :checked="model.length === 0"
        :data-editor-focus="model.length === 0 ? '' : undefined"
        @change="setSelection([])"
      />
      <span
        ><strong>{{ allOption.label }}</strong
        ><small>{{ allOption.description }}</small></span
      >
    </label>
    <label v-for="option in options" :key="option.value" class="collection-filter-choices__option">
      <input
        :type="multiple ? 'checkbox' : 'radio'"
        :name="groupId"
        :value="option.value"
        :checked="isChecked(option.value)"
        :data-editor-focus="isChecked(option.value) ? '' : undefined"
        @change="select(option.value)"
      />
      <span
        ><strong>{{ option.label }}</strong
        ><small>{{ option.description }}</small></span
      >
    </label>
  </fieldset>
</template>

<style scoped>
.collection-filter-choices {
  display: grid;
  gap: var(--am-space-3);
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.collection-filter-choices__option {
  display: flex;
  align-items: center;
  gap: var(--am-space-3);
  min-block-size: 64px;
  padding: var(--am-space-3) var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface);
  cursor: pointer;
}
.collection-filter-choices__option:has(input:checked) {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
}
.collection-filter-choices__option:has(input:focus-visible) {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.collection-filter-choices__option input {
  inline-size: 18px;
  block-size: 18px;
  margin: 0;
  flex: 0 0 auto;
  accent-color: var(--am-color-primary);
}
.collection-filter-choices__option > span {
  display: grid;
  gap: var(--am-space-1);
}
.collection-filter-choices__option small {
  color: var(--am-color-text-secondary);
  line-height: 1.5;
}
</style>
