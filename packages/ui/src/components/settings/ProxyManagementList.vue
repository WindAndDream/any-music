<script setup lang="ts">
import { shallowRef, useId } from 'vue'

const props = defineProps<{
  proxies: readonly {
    id: string
    name: string
    url: string
    protocol: string
    accountNames: readonly string[]
  }[]
  busy: boolean
}>()
const emit = defineEmits<{ remove: [id: string] }>()
const listId = useId()
const deleting = shallowRef<string | null>(null)
function requestRemove(id: string) {
  const proxy = props.proxies.find((item) => item.id === id)
  if (props.busy || !proxy || proxy.accountNames.length) return
  emit('remove', id)
  deleting.value = null
}
</script>

<template>
  <section class="settings-form__card proxy-management" aria-label="已保存的代理" :aria-busy="busy">
    <div class="settings-form__heading"><h4>代理列表</h4></div>
    <div v-if="!proxies.length" class="proxy-management__empty">
      <strong>尚未添加代理</strong>
      <p class="settings-form__hint">所有账号默认直连，可在上方添加第一个代理。</p>
    </div>
    <ul v-else class="proxy-management__list" aria-label="已保存的代理">
      <li v-for="proxy in proxies" :key="proxy.id" class="proxy-management__row">
        <div class="proxy-management__connection">
          <div class="proxy-management__identity">
            <strong class="proxy-management__name">{{ proxy.name }}</strong>
            <span class="proxy-management__protocol">{{ proxy.protocol }}</span>
          </div>
          <code class="proxy-management__address">{{ proxy.url }}</code>
        </div>
        <div class="proxy-management__assignment">
          <span
            class="proxy-management__status"
            :class="{ 'proxy-management__status--assigned': proxy.accountNames.length }"
            >{{
              proxy.accountNames.length ? `已分配 ${proxy.accountNames.length} 个账号` : '未分配'
            }}</span
          >
          <p
            v-if="proxy.accountNames.length"
            :id="`${listId}-${proxy.id}-assigned`"
            class="settings-form__hint"
          >
            已分配给 {{ proxy.accountNames.join('、') }}，解除分配后可删除。
          </p>
        </div>
        <div class="proxy-management__actions">
          <button
            class="proxy-management__button proxy-management__button--danger"
            type="button"
            :disabled="busy || proxy.accountNames.length > 0"
            :aria-label="`删除代理 ${proxy.name}`"
            :aria-describedby="
              proxy.accountNames.length ? `${listId}-${proxy.id}-assigned` : undefined
            "
            @click="deleting = proxy.id"
          >
            删除
          </button>
        </div>
        <div
          v-if="deleting === proxy.id"
          class="proxy-management__confirmation"
          role="alert"
          @keydown.esc="deleting = null"
        >
          <p class="settings-form__hint">
            确认删除“{{ proxy.name }}”？删除后需要重新添加才能使用。
          </p>
          <div class="settings-form__footer">
            <button class="proxy-management__button" type="button" @click="deleting = null">
              取消
            </button>
            <button
              class="proxy-management__button proxy-management__button--danger"
              type="button"
              :disabled="busy || proxy.accountNames.length > 0"
              :aria-label="`确认删除代理 ${proxy.name}`"
              @click="requestRemove(proxy.id)"
            >
              确认删除
            </button>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.proxy-management {
  display: grid;
  gap: var(--am-space-3);
  container: proxy-management / inline-size;
}
.proxy-management__list {
  display: grid;
  margin: 0;
  padding: 0 var(--am-space-4);
  list-style: none;
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface);
}
.proxy-management__row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--am-space-3) var(--am-space-4);
  padding-block: var(--am-space-4);
}
.proxy-management__row + .proxy-management__row {
  border-block-start: 1px solid var(--am-color-border);
}
.proxy-management__connection,
.proxy-management__assignment {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-2);
}
.proxy-management__identity {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--am-space-2);
}
.proxy-management__name {
  overflow-wrap: anywhere;
}
.proxy-management__protocol {
  padding: 2px var(--am-space-2);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-surface-hover);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.proxy-management__address {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  line-height: 1.6;
  overflow-wrap: anywhere;
  user-select: text;
}
.proxy-management__status {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-weight: 600;
}
.proxy-management__status--assigned {
  color: var(--am-color-primary);
}
.proxy-management__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  min-block-size: 44px;
  padding: var(--am-space-2) var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-background);
  color: var(--am-color-text);
  font: inherit;
  cursor: pointer;
}
.proxy-management__button--danger {
  color: var(--am-color-danger);
}
.proxy-management__button:hover:not(:disabled) {
  background: var(--am-color-surface-hover);
}
.proxy-management__button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.proxy-management__button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.proxy-management__confirmation {
  grid-column: 1 / -1;
  display: grid;
  gap: var(--am-space-3);
  padding-block-start: var(--am-space-3);
}
.proxy-management__empty {
  display: grid;
  justify-items: center;
  gap: var(--am-space-1);
  padding: var(--am-space-6) var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
  text-align: center;
}
@container proxy-management (max-width: 560px) {
  .proxy-management__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .proxy-management__assignment {
    grid-column: 1;
    grid-row: 2;
  }
  .proxy-management__actions {
    grid-column: 2;
    grid-row: 1 / 3;
  }
}
</style>
