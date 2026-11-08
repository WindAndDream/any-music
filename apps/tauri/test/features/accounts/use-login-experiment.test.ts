import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import type { LoginExperimentSnapshot } from '@/features/accounts/login-experiment'
import { useLoginExperiment } from '@/features/accounts/use-login-experiment'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
const scopes: ReturnType<typeof effectScope>[] = []
function snapshot(runId = 'run-a'): LoginExperimentSnapshot {
  return {
    runId,
    mode: 'headed-hidden',
    phase: 'waiting',
    browser: 'Chrome',
    version: 'fixture',
    login: { status: 'waiting', qrImage: 'data:image/png;base64,fixture' },
    browserLogin: false,
    rustSession: 'not-checked',
    smsRequested: false,
    smsVerified: false,
    windowObservation: 'not-observed',
    visibleFallback: false,
    cleanup: 'pending',
  }
}
function setup() {
  const scope = effectScope()
  scopes.push(scope)
  return { trial: scope.run(useLoginExperiment)!, scope }
}
function calls(name: string) {
  return native.invoke.mock.calls.filter(([command]) => command === name)
}
beforeEach(() => {
  vi.useFakeTimers()
  native.invoke.mockReset().mockImplementation(async (name: string) => {
    if (name === 'login_experiment_enabled') return true
    if (name === 'begin_login_experiment') return 'run-a'
    if (name === 'poll_login_experiment') return snapshot()
    if (name === 'cancel_login_experiment')
      return {
        ...snapshot(),
        phase: 'cancelled',
        cleanup: 'complete',
        login: { status: 'expired' },
      }
  })
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.useRealTimers()
})
describe('isolated login experiment lifecycle', () => {
  it('requires native capability and never invokes formal account commands', async () => {
    native.invoke.mockResolvedValue(false)
    const { trial } = setup()
    await Promise.resolve()
    await trial.start()
    expect(calls('begin_login_experiment')).toHaveLength(0)
    native.invoke.mockImplementation(async (name: string) =>
      name === 'login_experiment_enabled'
        ? true
        : name === 'begin_login_experiment'
          ? 'run-a'
          : snapshot(),
    )
    const enabled = setup().trial
    await Promise.resolve()
    await enabled.start()
    expect(calls('begin_login_experiment')[0]?.[1]).toEqual({ mode: 'headed-hidden' })
    expect(
      native.invoke.mock.calls.some(([name]) => /account|qr_login|browser_login/.test(name)),
    ).toBe(false)
  })
  it('cleans up a run returned after disposal and ignores late poll results', async () => {
    let resolve!: (id: string) => void
    native.invoke.mockImplementation(async (name: string) => {
      if (name === 'login_experiment_enabled') return true
      if (name === 'begin_login_experiment')
        return new Promise<string>((done) => {
          resolve = done
        })
      return snapshot()
    })
    const { trial, scope } = setup()
    await Promise.resolve()
    const starting = trial.start()
    await Promise.resolve()
    scope.stop()
    resolve('late-run')
    await starting
    expect(calls('cancel_login_experiment')).toContainEqual([
      'cancel_login_experiment',
      { runId: 'late-run' },
    ])
    expect(trial.active.value).toBe('')
    expect(trial.current.value).toBeUndefined()
  })
  it('keeps polling for cleanup after success and limits duplicate SMS', async () => {
    const { trial } = setup()
    await Promise.resolve()
    await trial.start()
    trial.current.value = {
      ...snapshot(),
      login: {
        status: 'verification-required',
        verification: {
          methods: [{ id: 'mobile_sms_verify', label: '接收短信', inApp: true }],
          selectedMethod: '',
          maskedMobile: '',
          retryAfter: 60,
          codeLength: 6,
        },
      },
    }
    await trial.resendSms()
    expect(calls('send_experiment_sms')).toHaveLength(0)
    native.invoke.mockImplementation(async (name: string) =>
      name === 'poll_login_experiment'
        ? {
            ...snapshot(),
            phase: 'finished',
            browserLogin: true,
            cleanup: 'pending',
            login: { status: 'signed-in' },
          }
        : undefined,
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(trial.active.value).toBe('run-a')
    native.invoke.mockImplementation(async () => ({
      ...snapshot(),
      phase: 'finished',
      cleanup: 'complete',
      login: { status: 'signed-in' },
    }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(trial.active.value).toBe('')
    expect(trial.results.value).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls('poll_login_experiment')).toHaveLength(3)
  })
  it('requires an explicit action for visible fallback and scopes cancellation', async () => {
    const { trial } = setup()
    await Promise.resolve()
    await trial.start()
    await trial.selectVerification('face_verify')
    expect(calls('open_experiment_browser')).toHaveLength(0)
    await trial.openBrowser()
    expect(calls('open_experiment_browser')[0]?.[1]).toEqual({ runId: 'run-a' })
    await trial.cancel()
    expect(trial.current.value?.cleanup).toBe('complete')
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls('poll_login_experiment')).toHaveLength(2)
  })
})
