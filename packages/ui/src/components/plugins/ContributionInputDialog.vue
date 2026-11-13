<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'

import type { ActiveConfirmationRequest } from '../../composables/use-confirmation-dialog'
import type { UiContributionItem } from '../../product/ui-contributions'
import AppIcon from '../AppIcon.vue'
import ConfirmationDialog from '../product-workbench/ConfirmationDialog.vue'

const props = defineProps<{
  open: boolean
  title: string
  label: string
  options?: UiContributionItem['inputOptions']
  selectionCount: number
}>()
const emit = defineEmits<{ close: []; submit: [values: readonly string[]] }>()
const input = shallowRef('')
const query = shallowRef('')
// Choices remain a local draft until the shared confirmation button is pressed.
const selectedValues = shallowRef<readonly string[]>([])
function tagKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}
const filteredOptions = computed(() => {
  const search = tagKey(query.value)
  return (props.options ?? []).filter((option) => tagKey(option.value).includes(search))
})
const pendingValues = computed(() => {
  const applied = new Set(
    props.options?.filter((option) => option.selected).map((option) => tagKey(option.value)),
  )
  const pending = new Map<string, string>()
  for (const value of [...selectedValues.value, input.value.trim()]) {
    const key = tagKey(value)
    if (key && !applied.has(key) && !pending.has(key)) pending.set(key, value)
  }
  return [...pending.values()]
})
const request = computed<ActiveConfirmationRequest | undefined>(() =>
  props.open
    ? {
        id: 1,
        title: props.title,
        message: `确定为已选的 ${props.selectionCount} 首歌曲添加标签吗？选择已有标签或输入新标签，确认后添加。`,
        confirmLabel: '确认添加',
        cancelLabel: '取消',
        tone: 'default',
      }
    : undefined,
)
watch(
  () => props.open,
  () => {
    input.value = ''
    query.value = ''
    selectedValues.value = []
  },
  { flush: 'sync' },
)
function isSelected(value: string): boolean {
  return selectedValues.value.some((selected) => tagKey(selected) === tagKey(value))
}
function toggle(value: string): void {
  if (!props.open || props.options?.some((option) => option.value === value && option.selected))
    return
  selectedValues.value = isSelected(value)
    ? selectedValues.value.filter((selected) => tagKey(selected) !== tagKey(value))
    : [...selectedValues.value, value]
}
function submit(): void {
  if (props.open && pendingValues.value.length) emit('submit', pendingValues.value)
}
function submitOnEnter(event: KeyboardEvent): void {
  if (event.isComposing) return
  event.preventDefault()
  submit()
}
</script>

<template>
  <ConfirmationDialog
    :request="request"
    role="dialog"
    :confirm-disabled="!pendingValues.length"
    @confirm="submit"
    @cancel="emit('close')"
  >
    <form class="contribution-input" @submit.prevent="submit">
      <label class="contribution-input__field">
        {{ label }}
        <input
          v-model="input"
          name="contribution-input"
          maxlength="32"
          autocomplete="off"
          :aria-label="label"
          placeholder="输入标签名称…"
          @keydown.enter="submitOnEnter"
        />
      </label>
      <section class="contribution-input__existing" aria-label="已有标签">
        <strong class="contribution-input__heading">已有标签</strong>
        <label v-if="options?.length" class="contribution-input__field">
          搜索标签
          <input v-model="query" name="tag-search" type="search" placeholder="搜索已有标签…" />
        </label>
        <p class="contribution-input__hint">
          可选择多个标签，点击“确认添加”后生效。“已添加”表示全部已选歌曲已有该标签。
        </p>
        <div class="contribution-input__choices" role="group" aria-label="全部标签">
          <button
            v-for="option in filteredOptions"
            :key="option.value"
            class="contribution-input__button"
            type="button"
            :aria-label="`添加标签 ${option.value}`"
            :aria-pressed="option.selected || isSelected(option.value)"
            :disabled="option.selected"
            @click="toggle(option.value)"
          >
            <AppIcon v-if="option.selected || isSelected(option.value)" name="check" :size="16" />
            <span>#{{ option.value }}</span>
            <small v-if="option.selected">已添加</small>
            <small v-else-if="isSelected(option.value)">待添加</small>
          </button>
        </div>
        <p v-if="!filteredOptions.length" class="contribution-input__hint">
          {{ options?.length ? '没有匹配的标签。' : '暂无已有标签，可输入新标签后确认添加。' }}
        </p>
      </section>
    </form>
  </ConfirmationDialog>
</template>

<style scoped>
.contribution-input,
.contribution-input__field,
.contribution-input__existing {
  display: grid;
  gap: var(--am-space-3);
  min-inline-size: 0;
}
.contribution-input__field,
.contribution-input__heading {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
.contribution-input__existing {
  padding-block-start: var(--am-space-4);
  border-block-start: 1px solid var(--am-color-border);
}
.contribution-input__field input {
  min-inline-size: 0;
  min-block-size: 44px;
  padding: var(--am-space-2) var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
}
.contribution-input__hint {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  line-height: 1.6;
}
.contribution-input__choices {
  display: flex;
  flex-wrap: wrap;
  align-content: start;
  gap: var(--am-space-2);
  max-block-size: 45dvh;
  overflow-y: auto;
}
.contribution-input__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  min-inline-size: 0;
  min-block-size: 44px;
  padding: var(--am-space-2) var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.contribution-input__button[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}
.contribution-input__button:hover:not(:disabled) {
  background: var(--am-color-surface-hover);
}
.contribution-input__button:disabled {
  cursor: default;
}
.contribution-input__button small {
  font-size: var(--am-font-size-xs);
}
.contribution-input__field input:focus-visible,
.contribution-input__button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
