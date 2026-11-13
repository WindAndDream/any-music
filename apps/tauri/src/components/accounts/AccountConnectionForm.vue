<script setup lang="ts">
import { AppIcon } from '@any-music/ui'
import type { EditingSession } from '@any-music/ui'
import { computed, useId } from 'vue'

import { useAccountConnectionDraft } from '../../features/accounts/account-editor-state'
import type { NativeAccount, NativeProxy } from '../../features/accounts/account-runtime'
const props = defineProps<{
  account: NativeAccount
  proxies: NativeProxy[]
  busy: boolean
  editing?: EditingSession
}>()
const emit = defineEmits<{ save: [account: NativeAccount] }>()
const connectionId = useId()
const { primary, backups } = useAccountConnectionDraft(props.account, props.editing)
const available = computed(() =>
  props.proxies.filter((proxy) => proxy.id !== primary.value && !backups.value.includes(proxy.id)),
)
function setPrimary(id: string) {
  primary.value = id
  backups.value = primary.value
    ? backups.value.filter((backupId) => backupId !== primary.value)
    : []
}
function add(id: string) {
  if (backups.value.length < 8 && available.value.some((proxy) => proxy.id === id))
    backups.value = [...backups.value, id]
}
function move(index: number, offset: number) {
  const next = [...backups.value]
  const target = index + offset
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  backups.value = next
}
</script>
<template>
  <form
    class="settings-form settings-form__card"
    @submit.prevent="
      emit('save', { ...account, proxyId: primary || null, backupProxyIds: primary ? backups : [] })
    "
  >
    <fieldset class="connection-options" :disabled="busy">
      <legend class="connection-options__title">主要连接</legend>
      <div class="connection-options__list">
        <label class="connection-option" :class="{ 'connection-option--selected': !primary }">
          <input
            type="radio"
            :name="connectionId"
            value=""
            :checked="!primary"
            @change="setPrimary('')"
          />
          <span class="connection-option__text">
            <strong>直连</strong>
            <small>使用本机网络，不经过代理。</small>
          </span>
        </label>
        <label
          v-for="proxy in proxies"
          :key="proxy.id"
          class="connection-option"
          :class="{ 'connection-option--selected': primary === proxy.id }"
        >
          <input
            type="radio"
            :name="connectionId"
            :value="proxy.id"
            :checked="primary === proxy.id"
            @change="setPrimary(proxy.id)"
          />
          <span class="connection-option__text">
            <strong>{{ proxy.name }}</strong>
            <small>{{ proxy.url }}</small>
          </span>
        </label>
      </div>
    </fieldset>
    <p v-if="!proxies.length" class="settings-form__hint">
      还没有代理，请先在设置的“代理管理”中添加。
    </p>
    <template v-if="primary">
      <div class="native-settings__heading">
        <h4>备用代理</h4>
        <p class="settings-form__hint">
          主代理连接失败时，按以下顺序逐个尝试；成功后沿用该代理。不自动回退到直连。
        </p>
      </div>
      <ol class="connection-backups" aria-label="备用代理尝试顺序">
        <li v-for="(id, index) in backups" :key="id">
          <span
            >{{ index + 1 }}.
            {{ proxies.find((proxy) => proxy.id === id)?.name ?? '代理已移除' }}</span
          >
          <div>
            <button
              class="native-settings__button"
              type="button"
              :aria-label="`上移备用代理 ${index + 1}`"
              :disabled="busy || index === 0"
              @click="move(index, -1)"
            >
              <AppIcon name="arrow-up" :size="16" />
            </button>
            <button
              class="native-settings__button"
              type="button"
              :aria-label="`下移备用代理 ${index + 1}`"
              :disabled="busy || index === backups.length - 1"
              @click="move(index, 1)"
            >
              <AppIcon name="arrow-down" :size="16" />
            </button>
            <button
              class="native-settings__button"
              type="button"
              :aria-label="`移除备用代理 ${index + 1}`"
              :disabled="busy"
              @click="backups = backups.filter((value) => value !== id)"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </div>
        </li>
      </ol>
      <fieldset class="connection-options" :disabled="busy || backups.length >= 8">
        <legend class="connection-options__title">添加备用代理（最多 8 个）</legend>
        <div v-if="available.length" class="connection-options__list">
          <button
            v-for="proxy in available"
            :key="proxy.id"
            class="connection-option"
            type="button"
            :aria-label="`添加备用代理 ${proxy.name}`"
            @click="add(proxy.id)"
          >
            <AppIcon name="plus" :size="18" />
            <span class="connection-option__text">
              <strong>{{ proxy.name }}</strong>
              <small>{{ proxy.url }}</small>
            </span>
          </button>
        </div>
        <p v-else class="settings-form__hint">没有其他可选代理。</p>
      </fieldset>
      <p v-if="backups.length >= 8" class="settings-form__hint" role="status">
        已达到备用代理上限，移除一个后可继续添加。
      </p>
    </template>
    <div class="settings-form__footer">
      <button class="settings-form__save" type="submit" :disabled="busy">保存连接</button>
    </div>
  </form>
</template>
<style scoped>
.connection-options {
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.connection-options__title {
  margin-block-end: var(--am-space-2);
  padding: 0;
  font-size: var(--am-font-size-sm);
  font-weight: 700;
}
.connection-options__list {
  display: grid;
  gap: var(--am-space-2);
}
.connection-option {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: center;
  gap: var(--am-space-3);
  min-block-size: 64px;
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.connection-option--selected {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
}
.connection-option__text {
  display: grid;
  gap: var(--am-space-1);
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.connection-option__text small {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.connection-option input {
  inline-size: 18px;
  block-size: 18px;
  margin: 0;
  accent-color: var(--am-color-primary);
}
.connection-option:hover {
  background: var(--am-color-surface-hover);
}
.connection-option:focus-visible,
.connection-option:has(input:focus-visible) {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.connection-options:disabled .connection-option {
  opacity: 0.5;
  cursor: not-allowed;
}
.connection-backups {
  display: grid;
  gap: var(--am-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.connection-backups li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-2);
  padding: var(--am-space-2);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
}
.connection-backups li > span {
  overflow-wrap: anywhere;
  flex: 1 1 8rem;
}
.connection-backups li > div {
  display: flex;
  gap: var(--am-space-1);
}
</style>
