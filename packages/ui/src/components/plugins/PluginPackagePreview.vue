<script setup lang="ts">
import { shallowRef, useId } from 'vue'

import type { NativePluginPackagePreview } from '../../product/native-plugin-authority'
import PluginPackageConsent from './PluginPackageConsent.vue'
import PluginSettingsSection from './PluginSettingsSection.vue'

const props = defineProps<{
  preview?: NativePluginPackagePreview
  busy: boolean
  nativePickerSupported?: boolean
  remoteSupported?: boolean
}>()
const emit = defineEmits<{
  selectFile: [file: File]
  clear: []
  chooseNative: []
  previewUrl: [url: string]
  install: [capabilities: readonly string[], transferData: boolean, userLinkedNetwork: boolean]
}>()
const packageUrl = shallowRef('')
const formId = useId()
function previewUrl() {
  const url = packageUrl.value.trim()
  if (url) emit('previewUrl', url)
  packageUrl.value = ''
}
function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('selectFile', file)
}
</script>

<template>
  <div class="am-package-preview settings-sections" aria-label="插件包安装预览" :aria-busy="busy">
    <PluginSettingsSection
      title="导入音乐源"
      description="先校验本地快照并展示身份与权限。选择文件不会执行插件或授予权限。"
    >
      <div class="am-package-preview__imports settings-sections">
        <form
          v-if="remoteSupported"
          :id="formId"
          class="settings-form am-package-preview__remote"
          @submit.prevent="previewUrl"
        >
          <label class="settings-form__field">
            <span>接口导入（公共 HTTPS 插件包地址）</span>
            <input
              v-model="packageUrl"
              type="url"
              autocomplete="off"
              placeholder="https://example.com/source.amplugin"
              :disabled="busy"
              required
            />
          </label>
          <div class="settings-form__footer">
            <button
              class="settings-form__save"
              type="submit"
              :disabled="busy || !packageUrl.trim()"
            >
              下载并预览
            </button>
          </div>
        </form>
        <div class="am-package-preview__local">
          <div class="settings-form__heading">
            <strong class="am-package-preview__label">文件导入（.amplugin）</strong>
            <p class="settings-form__hint">选择本地标准插件包，最大 16 MiB。</p>
          </div>
          <div class="settings-form__footer">
            <button
              v-if="nativePickerSupported"
              class="settings-form__button"
              type="button"
              :disabled="busy"
              @click="emit('chooseNative')"
            >
              从系统选择插件包
            </button>
            <label
              class="am-package-preview__file"
              :class="{ 'am-package-preview__file--busy': busy }"
            >
              <span>{{ nativePickerSupported ? '选择其他文件' : '选择插件包文件' }}</span>
              <input
                type="file"
                accept=".amplugin"
                aria-label="文件导入（.amplugin）"
                :disabled="busy"
                @change="selectFile"
              />
            </label>
          </div>
        </div>
      </div>
      <details class="am-package-preview__help">
        <summary>导入规范</summary>
        <p class="settings-form__hint">
          文件须为标准 .amplugin 插件包，大小不超过 16 MiB；接口须返回该格式的插件包，地址须为公共
          HTTPS。音乐源须声明 music.sources
          贡献。安装前将校验清单、完整性、所需能力与运行端支持情况，并由你确认授权。
        </p>
      </details>
    </PluginSettingsSection>
    <PluginPackageConsent
      v-if="preview"
      :preview="preview"
      :busy="busy"
      @clear="emit('clear')"
      @install="(caps, transfer, network) => emit('install', caps, transfer, network)"
    />
  </div>
</template>

<style scoped>
.am-package-preview {
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.am-package-preview__imports,
.am-package-preview__local {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-3);
}
.am-package-preview__imports {
  gap: 0;
}
.am-package-preview__remote,
.am-package-preview__local {
  padding: var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface);
}
.am-package-preview__remote {
  gap: var(--am-space-3);
}
.am-package-preview__label {
  font-size: var(--am-font-size-sm);
}
.am-package-preview__file {
  position: relative;
  display: inline-flex;
  min-block-size: 44px;
  max-inline-size: 100%;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding: var(--am-space-2) var(--am-space-4);
  border: 1px dashed var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-primary);
  font-weight: 600;
  cursor: pointer;
}
.am-package-preview__file input {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  opacity: 0;
  cursor: pointer;
}
.am-package-preview__file:hover:not(.am-package-preview__file--busy) {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
}
.am-package-preview__file:focus-within {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.am-package-preview__file--busy {
  opacity: 0.5;
}
.am-package-preview__file--busy input {
  cursor: not-allowed;
}
.am-package-preview__help {
  padding-block-start: var(--am-space-3);
}
.am-package-preview__help summary {
  min-block-size: 44px;
  padding-block: var(--am-space-3);
  color: var(--am-color-text-secondary);
  line-height: 20px;
  cursor: pointer;
}
.am-package-preview__help summary:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.am-package-preview__help p {
  margin-block-start: var(--am-space-2);
}
</style>
