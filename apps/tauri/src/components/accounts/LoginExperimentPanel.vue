<script setup lang="ts">
import { useLoginExperiment } from '../../features/accounts/use-login-experiment'
import AccountQrCode from './AccountQrCode.vue'
import AccountVerificationPanel from './AccountVerificationPanel.vue'

const trial = useLoginExperiment()
const sessionLabels = {
  'not-checked': '未检查',
  'signed-in': '已登录',
  'signed-out': '未登录',
  unavailable: '无法确认',
}
</script>
<template>
  <section
    v-if="trial.enabled.value"
    class="login-panel"
    aria-label="抖音后台登录试验"
    :aria-busy="trial.busy.value"
  >
    <h3>抖音后台登录试验 · 开发版本</h3>
    <p>使用独立临时浏览器，不保存试验凭证。复杂验证需要你主动打开官方浏览器，可能需要重新扫码。</p>
    <div class="account-row">
      <label
        >试验模式
        <select v-model="trial.mode.value" :disabled="trial.busy.value || !!trial.active.value">
          <option value="headed-hidden">有头进程 · 隐藏页面</option>
          <option value="headless">现代无头模式</option>
        </select>
      </label>
      <button
        type="button"
        :disabled="trial.busy.value || !!trial.active.value"
        @click="trial.start"
      >
        开始试验
      </button>
      <button
        type="button"
        :disabled="!trial.active.value"
        @click="
          trial.cancel().catch(() => {
            trial.error.value = '取消失败，请关闭应用以结束试验。'
          })
        "
      >
        取消并清理
      </button>
      <button
        type="button"
        :disabled="trial.busy.value || !trial.active.value || trial.current.value?.visibleFallback"
        @click="trial.openBrowser"
      >
        打开官方浏览器重新登录
      </button>
    </div>
    <p v-if="trial.error.value" role="alert">{{ trial.error.value }}</p>
    <p role="status" aria-live="polite">{{ trial.current.value?.login.message }}</p>
    <AccountQrCode :image="trial.current.value?.login.qrImage ?? ''" />
    <AccountVerificationPanel
      v-if="trial.current.value?.login.verification"
      :verification="trial.current.value.login.verification"
      :busy="trial.busy.value"
      :retry-after="trial.current.value.login.verification.retryAfter"
      @select="trial.selectVerification"
      @resend="trial.resendSms"
      @submit="trial.submitSms"
    />
    <div class="experiment-results" v-if="trial.results.value.length">
      <table>
        <caption>
          本次开发会话的公开观察结果
        </caption>
        <thead>
          <tr>
            <th scope="col">模式／版本</th>
            <th scope="col">浏览器登录</th>
            <th scope="col">Rust 会话</th>
            <th scope="col">短信</th>
            <th scope="col">窗口／清理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="result in trial.results.value" :key="result.runId">
            <th scope="row">
              {{ result.mode === 'headed-hidden' ? '有头隐藏页面' : '现代无头' }} ·
              {{ result.browser }} {{ result.version }}
            </th>
            <td>
              {{ result.browserLogin ? '已确认' : '未确认'
              }}{{ result.visibleFallback ? '（可见浏览器重试）' : '' }}
            </td>
            <td>{{ sessionLabels[result.rustSession] }}</td>
            <td>
              {{
                result.smsVerified ? '已验证' : result.smsRequested ? '已发送，未验证' : '未验证'
              }}
            </td>
            <td>
              {{
                result.windowObservation === 'window-observed' ? '观察到窗口' : '未观察到窗口'
              }}／{{
                result.cleanup === 'complete'
                  ? '已清理'
                  : result.cleanup === 'failed'
                    ? '清理失败'
                    : '运行中'
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      “未观察到窗口”仅表示 Windows 窗口事件监测结果，仍需确认实际闪现和任务栏表现。Rust
      检查重放浏览器新签名的自身资料请求，不代表独立本地签名已通过验证。
    </p>
  </section>
</template>
<style scoped>
.experiment-results {
  overflow: auto;
}
.experiment-results th,
.experiment-results td {
  padding: 0.5rem;
  text-align: start;
  border-bottom: 1px solid var(--am-color-border);
}
</style>
