<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { UiPluginCenterItem } from '@any-music/ui/theme'
import { computed } from 'vue'

import { pluginFailure, pluginStatusLabel } from '../../composables/plugin-presentation'

const props = defineProps<{
  item: UiPluginCenterItem
  busy: boolean
  selectable?: boolean
  selected?: boolean
}>()
const emit = defineEmits<{ setEnabled: [enabled: boolean]; retry: []; details: []; select: [] }>()
function checkAvailability(event: Event): void {
  if (!props.item.unavailableReason) return
  event.preventDefault()
  emit('setEnabled', true)
}
function changeEnabled(event: Event): void {
  const input = event.target as HTMLInputElement
  emit('setEnabled', input.checked)
  // Keep the control authoritative when the host rejects a change, e.g. the last source.
  input.checked = props.item.enabled
}
const failure = computed(() => pluginFailure(props.item))
const statusLabel = computed(() => pluginStatusLabel(props.item))
</script>

<template>
  <article
    class="classic-plugin-card"
    :data-origin="item.origin"
    :data-enabled="item.enabled"
    :data-selected="!!selected"
    :data-selectable="!!selectable"
  >
    <button
      class="classic-plugin-card__open"
      type="button"
      :aria-label="`${selectable ? '选择插件' : '查看插件介绍'} ${item.name}`"
      :aria-pressed="selectable ? !!selected : undefined"
      :aria-haspopup="selectable ? undefined : 'dialog'"
      :disabled="busy"
      @click="selectable ? emit('select') : emit('details')"
    />
    <header class="classic-plugin-card__header">
      <span class="classic-plugin-card__icon">
        <AppIcon :name="item.category === '音乐源' ? 'music' : 'plugin'" :size="24" />
      </span>
      <div class="classic-plugin-card__identity">
        <h3>{{ item.name }}</h3>
        <span>{{ item.category }} · {{ item.origin === 'builtin' ? '内置' : '外置' }}</span>
      </div>
    </header>
    <p class="classic-plugin-card__description">{{ item.description }}</p>
    <p v-if="item.publisher" class="classic-plugin-card__publisher">
      发布者 {{ item.publisher
      }}<template v-if="item.generation !== undefined"> · 代次 {{ item.generation }}</template>
    </p>
    <p v-if="failure" class="classic-plugin-card__error" role="alert">{{ failure }}</p>
    <footer class="classic-plugin-card__footer">
      <span
        class="classic-plugin-card__status"
        :data-error="!!failure"
        :data-enabled="item.enabled"
        :data-development-status="item.origin === 'builtin' ? item.developmentStatus : undefined"
        :role="item.status.status === 'loading' ? 'status' : undefined"
        >{{ statusLabel }}</span
      >
      <div class="classic-plugin-card__actions">
        <div class="classic-plugin-card__primary-actions">
          <button v-if="failure" type="button" :disabled="busy" @click="emit('retry')">
            <AppIcon name="refresh" :size="15" />重试
          </button>
          <label v-if="item.origin === 'builtin'" class="classic-plugin-card__toggle">
            <span>{{ item.enabled ? '启用中' : '已停用' }}</span>
            <input
              type="checkbox"
              role="switch"
              :aria-label="`启用 ${item.name}`"
              :checked="item.enabled"
              :disabled="busy"
              :aria-disabled="!!item.unavailableReason"
              :title="item.unavailableReason"
              @click="checkAvailability"
              @change="changeEnabled"
            />
            <span class="classic-plugin-card__switch" aria-hidden="true"></span>
          </label>
        </div>
        <label v-if="selectable" class="classic-plugin-card__selection">
          <input
            type="checkbox"
            :checked="selected"
            :disabled="busy"
            :aria-label="`勾选插件 ${item.name}`"
            @change="emit('select')"
          />
        </label>
      </div>
    </footer>
    <button
      class="classic-plugin-card__more"
      type="button"
      :disabled="busy"
      :aria-label="`更多插件操作 ${item.name}`"
      aria-haspopup="dialog"
      @click="emit('details')"
    >
      <AppIcon name="more" :size="20" />
    </button>
  </article>
</template>
