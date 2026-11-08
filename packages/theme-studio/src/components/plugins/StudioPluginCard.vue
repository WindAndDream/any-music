<script setup lang="ts">
import { getPluginFailure, getPluginStatusLabel } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { UiPluginCenterItem } from '@any-music/ui/theme'
import { computed } from 'vue'

const props = defineProps<{ item: UiPluginCenterItem; busy: boolean }>()
const emit = defineEmits<{ setEnabled: [enabled: boolean]; retry: []; manage: [] }>()
function checkAvailability(event: Event): void {
  if (!props.item.unavailableReason) return
  event.preventDefault()
  emit('setEnabled', true)
}
function changeEnabled(event: Event): void {
  const input = event.target as HTMLInputElement
  emit('setEnabled', input.checked)
  // The host may reject disabling its last source; retain the confirmed state.
  input.checked = props.item.enabled
}
const failure = computed(() => getPluginFailure(props.item))
const label = computed(() => getPluginStatusLabel(props.item))
</script>

<template>
  <article class="studio-plugin-card">
    <header class="studio-plugin-card__header">
      <AppIcon :name="item.category === '音乐源' ? 'music' : 'plugin'" :size="22" /><span>{{
        item.category
      }}</span
      ><span class="studio-plugin-card__origin">{{
        item.origin === 'builtin' ? '内置' : '外置'
      }}</span>
    </header>
    <div class="studio-plugin-card__body">
      <h2>{{ item.name }}</h2>
      <p>{{ item.description }}</p>
      <small v-if="item.publisher">发布者 {{ item.publisher }} · 代次 {{ item.generation }}</small>
      <p v-if="failure" role="alert">{{ failure }}</p>
    </div>
    <footer class="studio-plugin-card__footer">
      <span
        :data-enabled="item.enabled"
        :data-error="!!failure"
        :data-development-status="item.origin === 'builtin' ? item.developmentStatus : undefined"
        :role="item.status.status === 'loading' ? 'status' : undefined"
        >{{ label }}</span
      >
      <div class="studio-plugin-card__actions">
        <button v-if="failure" type="button" @click="emit('retry')">重试</button>
        <button
          v-if="item.origin === 'external'"
          type="button"
          :disabled="busy"
          :aria-label="`管理 ${item.name}`"
          aria-haspopup="dialog"
          @click="emit('manage')"
        >
          管理插件<AppIcon name="arrow-right" :size="15" />
        </button>
        <label v-else class="studio-selection"
          ><input
            type="checkbox"
            role="switch"
            :checked="item.enabled"
            :aria-label="`启用 ${item.name}`"
            :disabled="busy"
            :aria-disabled="!!item.unavailableReason"
            :title="item.unavailableReason"
            @click="checkAvailability"
            @change="changeEnabled"
          />启用</label
        >
      </div>
    </footer>
  </article>
</template>
