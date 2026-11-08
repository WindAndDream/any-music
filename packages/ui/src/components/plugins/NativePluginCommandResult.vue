<script setup lang="ts">
import { computed } from 'vue'

import { presentNativePluginResult } from '../../product/native-plugin-result'
import PluginSettingsSection from './PluginSettingsSection.vue'

const props = defineProps<{
  result: { token: string; value: unknown }
  tracks?: readonly { id: string; title: string }[]
  busy: boolean
}>()
const emit = defineEmits<{ save: [] }>()
const output = computed(() => presentNativePluginResult(props.result.value))
</script>

<template>
  <PluginSettingsSection title="插件命令结果">
    <p v-if="output.unavailable" class="settings-form__error" role="status">
      所需能力不可用或未授权，请检查权限后重试。
    </p>
    <p v-if="output.saved" class="settings-form__hint">已保存到此插件的独立数据空间。</p>
    <pre v-if="output.text !== undefined" class="plugin-command-result__text">{{
      output.text || '未选择曲目标题。'
    }}</pre>
    <ul v-if="output.items.length" class="plugin-command-result__list">
      <li v-for="(title, index) in output.items" :key="index">{{ title }}</li>
    </ul>
    <ul v-if="output.suggestions.length" class="plugin-command-result__list">
      <li v-for="item in output.suggestions" :key="item.id">
        {{ tracks?.find((track) => track.id === item.id)?.title ?? item.id }}：{{
          item.tags.join('、') || '暂无建议标签'
        }}
      </li>
    </ul>
    <details class="plugin-command-result__raw">
      <summary>查看原始结果</summary>
      <pre class="plugin-command-result__text">{{ JSON.stringify(result.value, null, 2) }}</pre>
    </details>
    <template #actions>
      <button class="settings-form__button" type="button" :disabled="busy" @click="emit('save')">
        选择位置保存此结果
      </button>
    </template>
  </PluginSettingsSection>
</template>

<style scoped>
.plugin-command-result__text {
  max-block-size: 320px;
  min-inline-size: 0;
  overflow: auto;
  margin: 0;
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-background);
  font-size: var(--am-font-size-xs);
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
.plugin-command-result__list {
  margin: 0;
  padding-inline-start: var(--am-space-5);
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.plugin-command-result__raw summary {
  min-block-size: 44px;
  padding-block: var(--am-space-3);
  color: var(--am-color-text-secondary);
  line-height: 20px;
  cursor: pointer;
}
.plugin-command-result__raw summary:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
