<script setup lang="ts">
import { useId } from 'vue'

import {
  type NetworkProxySettingsFormEmits,
  type NetworkProxySettingsFormProps,
  type NetworkProxySettingsFormModel,
  useNetworkProxySettingsForm,
} from '../../features/settings/use-network-proxy-settings-form'

const props = defineProps<
  NetworkProxySettingsFormProps & { form?: NetworkProxySettingsFormModel }
>()
const emit = defineEmits<NetworkProxySettingsFormEmits>()

const formId = useId()
const { errorMessage, isSocksProxy, proxyDraft, submitSettings, toggleProxyEnabled } =
  props.form ??
  useNetworkProxySettingsForm({
    emit,
    props,
  })
</script>

<template>
  <!-- 启用开关即时应用已保存配置；所有输入始终可编辑，保存不会改变启用状态。 -->
  <form
    class="settings-form settings-sections proxy-settings"
    novalidate
    @submit.prevent="submitSettings"
  >
    <div class="settings-form__card proxy-settings__activation">
      <div class="settings-form__heading">
        <strong>启用请求代理</strong>
        <p :id="`${formId}-activation`" class="settings-form__hint">
          {{
            props.settings.isEnabled
              ? '已启用，后续请求使用已保存的代理配置。'
              : '未启用，当前使用直连。已保存的配置会保留。'
          }}
        </p>
      </div>
      <button
        class="settings-switch"
        type="button"
        role="switch"
        aria-label="启用请求代理"
        :aria-checked="props.settings.isEnabled"
        :aria-describedby="`${formId}-activation`"
        @click="toggleProxyEnabled"
      >
        <span class="settings-switch__thumb" />
      </button>
    </div>
    <div class="settings-form__card">
      <h4 class="proxy-settings__title">代理配置</h4>
      <div class="proxy-settings__fields">
        <label class="settings-form__field">
          <span>类型</span>
          <select v-model="proxyDraft.type">
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks">SOCKS5</option>
            <option value="socks4">SOCKS4</option>
          </select>
        </label>
        <label class="settings-form__field">
          <span>端口</span>
          <input
            v-model.number="proxyDraft.port"
            type="number"
            min="1"
            max="65535"
            step="1"
            inputmode="numeric"
            required
            :aria-describedby="errorMessage ? `${formId}-error` : undefined"
          />
        </label>
        <label class="settings-form__field proxy-settings__host">
          <span>主机</span>
          <input
            v-model="proxyDraft.host"
            type="text"
            maxlength="255"
            placeholder="127.0.0.1"
            spellcheck="false"
            :aria-describedby="errorMessage ? `${formId}-error` : undefined"
          />
        </label>
        <label class="settings-form__field">
          <span>用户名（可选）</span>
          <input
            v-model="proxyDraft.username"
            type="text"
            maxlength="512"
            autocomplete="username"
          />
        </label>
        <label class="settings-form__field">
          <span>密码（可选）</span>
          <input
            v-model="proxyDraft.password"
            type="password"
            maxlength="512"
            autocomplete="current-password"
          />
        </label>
      </div>
      <label v-if="isSocksProxy" class="proxy-settings__dns">
        <input v-model="proxyDraft.proxyDns" type="checkbox" />
        通过代理解析 DNS
      </label>
      <p class="settings-form__hint">
        填写域名或 IP 即可，无需协议与端口。关闭代理时也可以编辑并保存配置。
      </p>
      <p class="settings-form__hint">
        代理用于平台 API、媒体下载和分段读取。当前由 Firefox 版 Tampermonkey 5.5+
        支持，其他环境保持直连。 代理凭据保存在当前脚本的 Tampermonkey 存储中。
      </p>
      <p v-if="errorMessage" :id="`${formId}-error`" class="settings-form__error" role="alert">
        {{ errorMessage }}
      </p>
      <div class="settings-form__footer">
        <button class="settings-form__save" type="submit">保存代理配置</button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.proxy-settings__activation {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}
.proxy-settings__title {
  margin: 0;
  font-size: var(--am-font-size-sm);
}
.proxy-settings__fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--am-space-4);
}
.proxy-settings__host {
  grid-column: 1 / -1;
}
.proxy-settings__dns {
  display: flex;
  min-block-size: 44px;
  align-items: center;
  gap: var(--am-space-2);
  cursor: pointer;
}
.proxy-settings__dns input {
  inline-size: 20px;
  block-size: 20px;
  accent-color: var(--am-color-primary);
}
@container am-settings (max-width: 480px) {
  .proxy-settings__fields {
    grid-template-columns: 1fr;
  }
}
</style>
