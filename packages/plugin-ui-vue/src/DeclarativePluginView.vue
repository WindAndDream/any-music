<script setup lang="ts">
import type { UiEvent } from '@any-music/plugin-sdk'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import type { DeclarativeSession } from './declarative-session'

const props = defineProps<{ session: DeclarativeSession }>()
const emit = defineEmits<{ action: [event: UiEvent]; rejected: [] }>()
defineSlots<{ 'track-list'?: (context: { listingRef: string }) => unknown }>()
const document = computed(() => props.session.document.value)
const formValues = shallowRef<Record<string, string>>({})
watch(
  () => props.session,
  (_session, previous) => previous.dispose(),
)
onScopeDispose(() => props.session.dispose())
watch(
  () => [props.session, document.value?.viewRevision],
  () => {
    formValues.value = {}
  },
)
function setValue(id: string, value: string) {
  formValues.value = { ...formValues.value, [id]: value }
}
function request(
  revision: number,
  node: NonNullable<DeclarativeSession['document']['value']>['nodes'][number],
) {
  try {
    const values =
      node.type === 'form'
        ? node.fields.map((field) => ({
            fieldId: field.id,
            value:
              formValues.value[`${node.id}/${field.id}`] ??
              (field.type === 'checkbox' ? 'false' : ''),
          }))
        : undefined
    emit('action', props.session.createEvent(revision, node.id, values))
  } catch {
    emit('rejected')
  }
}
</script>
<template>
  <section class="am-plugin-view" data-am-host-surface="plugin-view">
    <header class="am-plugin-view__identity" data-am-host-surface="plugin-identity" role="note">
      来自插件 {{ props.session.identity.name }} · {{ props.session.identity.ownerId }}
    </header>
    <div
      v-for="view in document ? [document] : []"
      :key="view.viewRevision"
      class="am-plugin-view__content"
    >
      <template v-for="node in view.nodes" :key="node.id">
        <p v-if="node.type === 'text'">{{ node.text }}</p>
        <button
          v-else-if="node.type === 'button'"
          type="button"
          @click="request(view.viewRevision, node)"
        >
          {{ node.label['zh-CN'] }}
        </button>
        <form v-else-if="node.type === 'form'" @submit.prevent="request(view.viewRevision, node)">
          <p role="note">请勿在插件界面输入账号或密码。</p>
          <label v-for="field in node.fields" :key="field.id">
            <span>{{ field.label['zh-CN'] }}</span>
            <input
              :type="field.type"
              :name="`${node.id}/${field.id}`"
              :maxlength="field.maxLength ?? 256"
              autocomplete="off"
              :value="
                field.type === 'checkbox' ? undefined : (formValues[`${node.id}/${field.id}`] ?? '')
              "
              :checked="formValues[`${node.id}/${field.id}`] === 'true'"
              @input="
                setValue(
                  `${node.id}/${field.id}`,
                  field.type === 'checkbox'
                    ? String(($event.target as HTMLInputElement).checked)
                    : ($event.target as HTMLInputElement).value,
                )
              "
            />
          </label>
          <button type="submit">{{ node.label['zh-CN'] }}</button>
        </form>
        <slot
          v-else-if="node.type === 'track-list'"
          name="track-list"
          :listing-ref="node.listingRef"
          ><p>此列表当前不可用。</p></slot
        >
      </template>
    </div>
  </section>
</template>
<style scoped>
.am-plugin-view {
  min-inline-size: 0;
  color: var(--am-color-text);
  background: var(--am-color-surface);
}
.am-plugin-view__identity {
  position: sticky;
  inset-block-start: 0;
  z-index: 1;
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  background: var(--am-color-surface);
  font-weight: 700;
  overflow-wrap: anywhere;
}
.am-plugin-view__content,
form,
label {
  display: grid;
  gap: var(--am-space-3);
}
.am-plugin-view__content {
  padding: var(--am-space-3);
  overflow-wrap: anywhere;
}
input,
button {
  min-block-size: 44px;
  min-inline-size: 0;
  max-inline-size: 100%;
  padding: var(--am-space-2);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  color: var(--am-color-text);
  background: var(--am-color-surface);
  font: inherit;
}
input:focus-visible,
button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
