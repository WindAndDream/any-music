<script setup lang="ts">
import { shallowRef } from 'vue'

import type { NativePluginSnapshot } from '../../product/native-plugin-authority'
import PluginSettingsSection from './PluginSettingsSection.vue'

/** Command drafts stay local; all execution, rollback and revocation go to the native owner. */
defineProps<{
  installs: readonly NativePluginSnapshot[]
  busy: boolean
  tracks?: readonly { id: string; title: string }[]
}>()
const emit = defineEmits<{
  refresh: []
  revoke: [id: string]
  rollback: [id: string]
  execute: [id: string, command: string, input: unknown]
}>()
const selected = shallowRef<string[]>([])
const query = shallowRef('')
</script>

<template>
  <PluginSettingsSection
    title="已安装的外置插件"
    description="查看本机安装与授权状态，撤销后停止后续数据访问。"
  >
    <div v-if="!installs.length" class="native-plugin-installs__empty" role="status">
      <strong>{{ busy ? '正在读取安装记录…' : '暂无原生插件安装记录。' }}</strong>
      <p v-if="!busy" class="settings-form__hint">从上方导入插件包，确认安装后会显示在这里。</p>
    </div>
    <details
      v-if="installs.some((install) => install.commands?.length)"
      class="native-plugin-installs__input"
    >
      <summary>本次命令输入</summary>
      <fieldset class="native-plugin-installs__fields" :disabled="busy">
        <legend class="am-sr-only">本次命令输入</legend>
        <label class="settings-form__field"
          ><span>来源查询</span><input v-model="query" type="search" maxlength="256"
        /></label>
        <p class="settings-form__hint">仅将勾选的曲目标题交给插件；最多 20 条。</p>
        <div v-if="tracks?.length" class="native-plugin-installs__tracks">
          <label
            v-for="track in tracks.slice(0, 20)"
            :key="track.id"
            class="native-plugin-installs__track"
          >
            <input v-model="selected" type="checkbox" :value="track.id" /><span>{{
              track.title
            }}</span>
          </label>
        </div>
      </fieldset>
    </details>
    <ul v-if="installs.length" class="native-plugin-installs__list">
      <li v-for="install in installs" :key="install.installId" class="native-plugin-installs__item">
        <div class="native-plugin-installs__content">
          <div class="native-plugin-installs__identity">
            <strong>{{ install.dev ? '[DEV] ' : '' }}{{ install.pluginId }}</strong>
            <span class="native-plugin-installs__status" :data-enabled="install.enabled">{{
              install.enabled ? '已启用' : '已撤销'
            }}</span>
          </div>
          <p class="settings-form__hint">
            发布者 {{ install.publisher }} · 版本代次 {{ install.generation }} · 历史数据
            {{ install.historicalLevel }}
          </p>
          <p v-if="install.commands?.length" class="settings-form__hint">
            命令去向：插件中心命令区
          </p>
          <p v-if="install.contributions?.includes('music.sources')" class="settings-form__hint">
            目录贡献：音乐平台选择器（当前不提供媒体解析）
          </p>
          <p
            v-if="install.contributions?.some((point) => point !== 'music.sources')"
            class="settings-form__hint"
          >
            其他可选贡献未分配到当前宿主。
          </p>
        </div>
        <div class="settings-form__footer native-plugin-installs__actions">
          <button
            v-for="command in install.commands"
            :key="command.id"
            class="settings-form__button"
            type="button"
            :disabled="busy || !install.enabled"
            @click="
              emit('execute', install.installId, command.id, {
                query,
                items:
                  tracks
                    ?.filter((track) => selected.includes(track.id))
                    .slice(0, 20)
                    .map((track) => ({ id: track.id, title: track.title })) ?? [],
              })
            "
          >
            {{ command.title['zh-CN'] }}
          </button>
          <button
            v-if="install.canRollback"
            class="settings-form__button"
            type="button"
            :disabled="busy"
            @click="emit('rollback', install.installId)"
          >
            回退代码与数据并撤权
          </button>
          <button
            class="settings-form__button native-plugin-installs__revoke"
            type="button"
            :disabled="busy || !install.enabled"
            :aria-label="`撤销 ${install.pluginId} 的授权`"
            @click="emit('revoke', install.installId)"
          >
            撤销授权
          </button>
        </div>
      </li>
    </ul>
    <template #actions>
      <button class="settings-form__button" type="button" :disabled="busy" @click="emit('refresh')">
        刷新授权状态
      </button>
    </template>
  </PluginSettingsSection>
</template>

<style scoped>
.native-plugin-installs__empty {
  display: grid;
  justify-items: center;
  gap: var(--am-space-1);
  padding: var(--am-space-6) var(--am-space-3);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
  text-align: center;
}
.native-plugin-installs__input summary {
  min-block-size: 44px;
  padding-block: var(--am-space-3);
  line-height: 20px;
  font-weight: 600;
  cursor: pointer;
}
.native-plugin-installs__fields {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-3);
  margin: var(--am-space-3) 0 0;
  padding: 0;
  border: 0;
}
.native-plugin-installs__tracks {
  display: grid;
  max-block-size: 240px;
  overflow: auto;
}
.native-plugin-installs__track {
  display: flex;
  min-block-size: 44px;
  align-items: center;
  gap: var(--am-space-3);
  padding-block: var(--am-space-2);
  overflow-wrap: anywhere;
  cursor: pointer;
}
.native-plugin-installs__track input {
  flex: none;
  inline-size: 18px;
  block-size: 18px;
  margin: 0;
  accent-color: var(--am-color-primary);
}
.native-plugin-installs__list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.native-plugin-installs__item {
  display: grid;
  gap: var(--am-space-4);
  min-inline-size: 0;
  padding-block: var(--am-space-4);
}
.native-plugin-installs__item + .native-plugin-installs__item {
  border-block-start: 1px solid var(--am-color-border);
}
.native-plugin-installs__content {
  display: grid;
  gap: var(--am-space-1);
}
.native-plugin-installs__identity {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--am-space-2);
  overflow-wrap: anywhere;
}
.native-plugin-installs__status {
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.native-plugin-installs__status[data-enabled='true'] {
  background: var(--am-color-success-container);
  color: var(--am-color-success);
}
.native-plugin-installs__revoke {
  color: var(--am-color-danger);
}
.native-plugin-installs__input summary:focus-visible,
.native-plugin-installs__track input:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
