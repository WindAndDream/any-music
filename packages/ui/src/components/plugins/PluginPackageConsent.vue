<script setup lang="ts">
import { shallowRef, watch } from 'vue'

import type { NativePluginPackagePreview } from '../../product/native-plugin-authority'
import PluginSettingsSection from './PluginSettingsSection.vue'

const props = defineProps<{ preview: NativePluginPackagePreview; busy: boolean }>()
const emit = defineEmits<{
  clear: []
  install: [capabilities: readonly string[], transferData: boolean, userLinkedNetwork: boolean]
}>()
const selectedCapabilities = shallowRef<string[]>([])
const transferData = shallowRef(false)
const userLinkedNetwork = shallowRef(false)
// Consent belongs to exactly one native preview; a replacement never inherits approvals.
watch(
  () => props.preview.token,
  () => {
    selectedCapabilities.value = []
    transferData.value = false
    userLinkedNetwork.value = false
  },
)
</script>

<template>
  <PluginSettingsSection title="插件包安装预览" description="核对插件身份与权限后，再确认安装。">
    <div class="package-consent__identity">
      <strong>{{ preview.pluginId }}</strong>
      <span class="package-consent__version">{{ preview.version }}</span>
      <span class="package-consent__publisher">
        {{ preview.publisherVerified ? '已固定的发布者密钥' : '发布者身份未验证' }}
      </span>
    </div>
    <dl class="package-consent__metadata">
      <div>
        <dt>发布者指纹</dt>
        <dd>{{ preview.publisher ?? '未签名' }}</dd>
      </div>
      <div>
        <dt>内容 SHA-256</dt>
        <dd>{{ preview.contentHash }}</dd>
      </div>
      <div>
        <dt>执行类型</dt>
        <dd>{{ preview.execution }}</dd>
      </div>
      <div>
        <dt>历史数据</dt>
        <dd>{{ preview.historicalLevel }}</dd>
      </div>
      <div>
        <dt>贡献去向</dt>
        <dd>{{ preview.contributions?.join('、') || '插件中心命令区' }}</dd>
      </div>
      <div>
        <dt>请求权限</dt>
        <dd>{{ preview.permissions.join('、') || '无' }}</dd>
      </div>
      <div>
        <dt>新增或须重新确认的权限</dt>
        <dd>{{ preview.addedPermissions.join('、') || '无' }}</dd>
      </div>
    </dl>
    <p v-if="preview.permissions.includes('network.publicHttps')" class="settings-form__hint">
      联网可发送已获授权的数据；签名和目的地范围不替代数据外发授权。
    </p>
    <p v-if="preview.dev" class="settings-form__hint">
      DEV：独立安装与数据，不使用正式账号或 Cookie。
    </p>
    <p v-if="preview.blockedReason" class="package-consent__notice" role="status">
      {{ preview.blockedReason }}
    </p>
    <fieldset v-if="preview.canInstall" class="package-consent__permissions" :disabled="busy">
      <legend>安装授权</legend>
      <label
        v-for="permission in preview.permissions"
        :key="permission"
        class="package-consent__permission"
      >
        <input v-model="selectedCapabilities" type="checkbox" :value="permission" />
        <span>允许 {{ permission }}</span>
      </label>
      <label class="package-consent__permission">
        <input v-model="transferData" type="checkbox" />
        <span>允许此次更新继承该插件原有数据（发布者未验证时必须单独确认）</span>
      </label>
      <label
        v-if="selectedCapabilities.includes('network.publicHttps')"
        class="package-consent__permission"
      >
        <input v-model="userLinkedNetwork" type="checkbox" />
        <span>允许公开网络处理本次查询数据；不开放私有资料</span>
      </label>
    </fieldset>
    <template #actions>
      <button class="settings-form__button" type="button" :disabled="busy" @click="emit('clear')">
        关闭预览
      </button>
      <button
        v-if="preview.canInstall"
        class="settings-form__save"
        type="button"
        :disabled="busy"
        @click="emit('install', selectedCapabilities, transferData, userLinkedNetwork)"
      >
        确认安装与授权
      </button>
    </template>
  </PluginSettingsSection>
</template>

<style scoped>
.package-consent__identity {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--am-space-2);
}
.package-consent__identity strong {
  overflow-wrap: anywhere;
}
.package-consent__version,
.package-consent__publisher {
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.package-consent__metadata {
  display: grid;
  margin: 0;
  padding: 0;
}
.package-consent__metadata > div {
  display: grid;
  gap: var(--am-space-1);
  padding-block: var(--am-space-3);
}
.package-consent__metadata dt {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.package-consent__metadata dd {
  margin: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
  user-select: text;
}
.package-consent__notice {
  margin: 0;
  padding: var(--am-space-3);
  border-inline-start: 3px solid var(--am-color-warning);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-warning-container);
  line-height: 1.7;
}
.package-consent__permissions {
  display: grid;
  min-inline-size: 0;
  margin: 0;
  padding: var(--am-space-3) 0 0;
  border: 0;
}
.package-consent__permissions legend {
  padding: 0 var(--am-space-2) 0 0;
  font-weight: 600;
}
.package-consent__permission {
  display: flex;
  align-items: flex-start;
  gap: var(--am-space-3);
  min-block-size: 44px;
  padding-block: var(--am-space-3);
  line-height: 1.6;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.package-consent__permission input {
  flex: none;
  inline-size: 18px;
  block-size: 18px;
  margin: 2px 0 0;
  accent-color: var(--am-color-primary);
}
.package-consent__permission input:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
