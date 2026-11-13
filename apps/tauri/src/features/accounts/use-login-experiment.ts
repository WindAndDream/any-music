import { invoke } from '@tauri-apps/api/core'
import { onScopeDispose, shallowRef } from 'vue'

import type { LoginExperimentMode, LoginExperimentSnapshot } from './login-experiment'

/** One serial experiment, generation guarded polling, and bounded public result history. */
export function useLoginExperiment() {
  const enabled = shallowRef(false)
  const busy = shallowRef(false)
  const error = shallowRef('')
  const mode = shallowRef<LoginExperimentMode>('headed-hidden')
  const current = shallowRef<LoginExperimentSnapshot>()
  const results = shallowRef<LoginExperimentSnapshot[]>([])
  const active = shallowRef('')
  let generation = 0
  let pollRevision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  void invoke<boolean>('login_experiment_enabled')
    .then((value) => {
      if (!disposed) enabled.value = value
    })
    .catch(() => {})
  function stopTimer() {
    pollRevision++
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  function present(snapshot: LoginExperimentSnapshot) {
    current.value = snapshot
    results.value = [...results.value.filter((old) => old.mode !== snapshot.mode), snapshot]
  }
  async function poll(expected: number, runId: string) {
    const revision = ++pollRevision
    try {
      const snapshot = await invoke<LoginExperimentSnapshot>('poll_login_experiment', { runId })
      if (disposed || expected !== generation || revision !== pollRevision) return
      present(snapshot)
      if (snapshot.cleanup !== 'pending') active.value = ''
      else
        timer = setTimeout(() => {
          void poll(expected, runId)
        }, 1000)
    } catch (cause) {
      if (!disposed && expected === generation && revision === pollRevision) {
        error.value = String(cause)
        active.value = ''
        // A transport failure still needs native cleanup; cancellation is scoped by the old UUID.
        void invoke('cancel_login_experiment', { runId }).catch(() => {})
      }
    }
  }
  async function cancel() {
    const runId = active.value
    generation++
    stopTimer()
    active.value = ''
    if (runId) {
      const snapshot = await invoke<LoginExperimentSnapshot | null>('cancel_login_experiment', {
        runId,
      })
      if (snapshot && !disposed && !active.value) present(snapshot)
    }
  }
  async function start() {
    if (!enabled.value || busy.value) return
    busy.value = true
    error.value = ''
    const expected = generation + 1
    try {
      await cancel()
      if (disposed || expected !== generation) return
      const runId = await invoke<string>('begin_login_experiment', { mode: mode.value })
      if (disposed || expected !== generation) {
        await invoke('cancel_login_experiment', { runId })
        return
      }
      active.value = runId
      await poll(expected, runId)
    } catch (cause) {
      if (!disposed) error.value = String(cause)
    } finally {
      if (!disposed) busy.value = false
    }
  }
  async function action(command: string, code?: string) {
    const runId = active.value
    if (!runId || busy.value) return
    if (
      command === 'send_experiment_sms' &&
      (current.value?.login.verification?.retryAfter ?? 0) > 0
    )
      return
    const expected = generation
    busy.value = true
    error.value = ''
    try {
      await invoke(command, { runId, ...(code === undefined ? {} : { code }) })
      if (expected === generation && !disposed) {
        stopTimer()
        await poll(expected, runId)
      }
    } catch (cause) {
      if (expected === generation && !disposed) error.value = String(cause)
    } finally {
      if (!disposed) busy.value = false
    }
  }
  function selectVerification(id: string) {
    if (id === 'mobile_sms_verify') return action('send_experiment_sms')
    error.value = '此验证方式需要官方浏览器，请点击“打开官方浏览器重新登录”。'
  }
  onScopeDispose(() => {
    disposed = true
    void cancel().catch(() => {})
  })
  return {
    enabled,
    busy,
    error,
    mode,
    current,
    results,
    active,
    start,
    cancel,
    selectVerification,
    resendSms: () => action('send_experiment_sms'),
    submitSms: (code: string) => action('submit_experiment_sms', code),
    openBrowser: () => action('open_experiment_browser'),
  }
}
