<script setup lang="ts">
import type { TagManagementPresentation } from '@any-music/ui/theme'
import { useId } from 'vue'

const props = defineProps<{ editor: TagManagementPresentation }>()
const inputId = `${useId()}-tag-name`
function updateName(event: Event): void {
  props.editor.actions.setCreateNameDraft((event.target as HTMLInputElement).value)
}
</script>

<template>
  <form class="tag-create" aria-label="创建标签" @submit.prevent="editor.actions.createTag">
    <label :for="inputId">标签名称</label>
    <span class="tag-create__input-control">
      <input
        :id="inputId"
        :value="editor.state.createNameDraft"
        type="text"
        name="tag-name"
        maxlength="32"
        autocomplete="off"
        placeholder="输入标签名称"
        data-tag-create-input
        @input="updateName"
      />
    </span>
    <button type="submit" :disabled="!editor.state.createNameDraft.trim()">创建标签</button>
  </form>
</template>

<style scoped>
.tag-create {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-3);
}
.tag-create label {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
/* Match the platform picker's underline, including its initial autofocus animation. */
.tag-create__input-control {
  position: relative;
  display: block;
  min-inline-size: 0;
}
.tag-create__input-control::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  block-size: 3px;
  background: var(--am-color-primary);
  pointer-events: none;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform var(--am-motion-slow) var(--am-ease-standard);
}
.tag-create__input-control:focus-within::after {
  transform: scaleX(1);
}
@starting-style {
  .tag-create__input-control:focus-within::after {
    transform: scaleX(0);
  }
}
.tag-create input {
  box-sizing: border-box;
  inline-size: 100%;
  min-inline-size: 0;
  min-block-size: 52px;
  padding: var(--am-space-2) 0;
  border: 0;
  border-block-end: 1px solid var(--am-color-border-strong);
  border-radius: 0;
  background: transparent;
  color: var(--am-color-text);
  font: inherit;
  font-size: var(--am-font-size-xl);
}
.tag-create input:focus,
.tag-create input:focus-visible {
  outline: none;
  box-shadow: none;
}
.tag-create button {
  justify-self: end;
  min-block-size: 44px;
  margin-block-start: var(--am-space-2);
  padding: var(--am-space-2) var(--am-space-4);
  border: 0;
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  font: 650 var(--am-font-size-sm) var(--am-font-family);
  cursor: pointer;
}
.tag-create button:hover:not(:disabled) {
  background: var(--am-color-primary-hover);
}
.tag-create button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.tag-create button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (prefers-reduced-motion: reduce) {
  .tag-create__input-control::after {
    transition: none;
  }
}
</style>
