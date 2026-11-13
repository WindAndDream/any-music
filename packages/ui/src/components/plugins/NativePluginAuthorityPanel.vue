<script setup lang="ts">
import type {
  NativePluginPackagePreview,
  NativePluginSnapshot,
} from '../../product/native-plugin-authority'
import NativePluginCommandResult from './NativePluginCommandResult.vue'
import NativePluginInstallList from './NativePluginInstallList.vue'
import PluginPackagePreview from './PluginPackagePreview.vue'

const props = defineProps<{
  installs: readonly NativePluginSnapshot[]
  busy: boolean
  errorMessage?: string
  previewSupported?: boolean
  packagePreview?: NativePluginPackagePreview
  nativePickerSupported?: boolean
  remoteSupported?: boolean
  devSupported?: boolean
  devPairingPath?: string
  tracks?: readonly { id: string; title: string }[]
  result?: { token: string; value: unknown }
  diagnostics?: readonly unknown[]
}>()
const emit = defineEmits<{
  refresh: []
  revoke: [installId: string]
  selectFile: [file: File]
  clearPreview: []
  chooseNative: []
  previewUrl: [url: string]
  beginDev: []
  endDev: []
  install: [capabilities: readonly string[], transferData: boolean, userLinkedNetwork: boolean]
  rollback: [id: string]
  execute: [id: string, command: string, input: unknown]
  saveResult: []
  refreshDiagnostics: []
  exportDiagnostics: []
}>()
</script>

<template>
  <section class="am-native-plugins" aria-label="原生插件授权" :aria-busy="busy">
    <p v-if="errorMessage" class="settings-form__error am-native-plugins__error" role="alert">
      {{ errorMessage }}
    </p>
    <div class="settings-sections">
      <PluginPackagePreview
        v-if="previewSupported"
        :preview="packagePreview"
        :busy="busy"
        :native-picker-supported="nativePickerSupported"
        :remote-supported="remoteSupported"
        @select-file="emit('selectFile', $event)"
        @clear="emit('clearPreview')"
        @choose-native="emit('chooseNative')"
        @preview-url="emit('previewUrl', $event)"
        @install="(caps, transfer, network) => emit('install', caps, transfer, network)"
      />
      <NativePluginInstallList
        :installs="installs"
        :busy="busy"
        :tracks="props.tracks"
        @refresh="emit('refresh')"
        @revoke="emit('revoke', $event)"
        @rollback="emit('rollback', $event)"
        @execute="(id, command, input) => emit('execute', id, command, input)"
      />
      <NativePluginCommandResult
        v-if="result"
        :result="result"
        :tracks="props.tracks"
        :busy="busy"
        @save="emit('saveResult')"
      />
      <div class="am-native-plugins__advanced settings-sections">
        <details class="am-native-plugins__disclosure">
          <summary>
            <span>诊断与排查</span>
          </summary>
          <div class="am-native-plugins__detail settings-form">
            <p class="settings-form__hint">查看脱敏诊断，或选择保存位置导出诊断记录。</p>
            <pre v-if="diagnostics?.length" class="am-native-plugins__code" aria-label="脱敏诊断">{{
              JSON.stringify(diagnostics, null, 2)
            }}</pre>
            <div class="settings-form__footer">
              <button
                class="settings-form__button"
                type="button"
                :disabled="busy"
                @click="emit('refreshDiagnostics')"
              >
                查看脱敏诊断
              </button>
              <button
                class="settings-form__button"
                type="button"
                :disabled="busy"
                @click="emit('exportDiagnostics')"
              >
                选择位置导出脱敏诊断
              </button>
            </div>
          </div>
        </details>
        <details
          v-if="devSupported || devPairingPath"
          class="am-native-plugins__disclosure"
          :open="devPairingPath ? true : undefined"
        >
          <summary>
            <span>开发者选项</span>
          </summary>
          <div class="am-native-plugins__detail settings-form">
            <p class="settings-form__hint">
              DEV 预览使用独立目录。配对文件在两分钟内单次有效；CLI 不会自动启动应用。
            </p>
            <template v-if="devPairingPath">
              <code class="am-native-plugins__code">{{ devPairingPath }}</code>
              <p class="settings-form__hint">
                将此路径传给 am-plugin dev --pairing-file。每次快照均需在此确认安装与授权。
              </p>
            </template>
            <div class="settings-form__footer">
              <button
                v-if="devPairingPath"
                class="settings-form__button"
                type="button"
                :disabled="busy"
                @click="emit('endDev')"
              >
                结束 DEV 配对
              </button>
              <button
                v-if="devSupported"
                class="settings-form__button"
                type="button"
                :disabled="busy"
                @click="emit('beginDev')"
              >
                选择 DEV 项目并配对
              </button>
            </div>
          </div>
        </details>
      </div>
    </div>
  </section>
</template>

<style scoped>
.am-native-plugins {
  min-inline-size: 0;
  color: var(--am-color-text);
  overflow-wrap: anywhere;
}
.am-native-plugins__error {
  margin-block-end: var(--am-space-5);
  padding: var(--am-space-3) var(--am-space-4);
  border-radius: var(--am-radius-control);
  background: var(--am-color-danger-container);
  line-height: 1.7;
}
.am-native-plugins__disclosure {
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface);
}
.am-native-plugins__disclosure summary {
  display: flex;
  min-block-size: 56px;
  align-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-3) var(--am-space-4);
  border-radius: inherit;
  font-size: var(--am-font-size-sm);
  font-weight: 600;
  list-style: none;
  cursor: pointer;
}
.am-native-plugins__disclosure summary::-webkit-details-marker {
  display: none;
}
.am-native-plugins__disclosure summary:hover {
  background: var(--am-color-surface-subtle);
}
.am-native-plugins__disclosure summary:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.am-native-plugins__detail {
  margin-inline: var(--am-space-4);
  padding-block: var(--am-space-4);
}
.am-native-plugins__code {
  display: block;
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
</style>
