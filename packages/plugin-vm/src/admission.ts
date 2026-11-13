import { VmError } from './contracts'
import { VM_PROFILE } from './profile'

/** Process-wide owner created by the trusted host; guest request IDs cannot reset it. */
export class VmAdmission {
  private active = 0
  private tasks = 0
  private subjects = new Map<string, { failures: number[]; calls: number[]; retryAt: number }>()
  private calls: number[] = []

  private readonly now: () => number
  constructor(now: () => number) {
    this.now = now
  }

  acquire(subject: string): (failed?: boolean) => void {
    if (!this.subjects.has(subject) && this.subjects.size >= 32) throw new VmError('budget')
    const state = this.subjects.get(subject) ?? { failures: [], calls: [], retryAt: 0 }
    state.failures = state.failures.filter((time) => time > this.now() - VM_PROFILE.crashWindowMs)
    this.subjects.set(subject, state)
    state.calls = state.calls.filter((time) => time > this.now() - 60_000)
    this.calls = this.calls.filter((time) => time > this.now() - 60_000)
    if (
      state.calls.length >= VM_PROFILE.callsPerMinute ||
      this.calls.length >= VM_PROFILE.globalCallsPerMinute
    )
      throw new VmError('budget')
    if (state.failures.length >= VM_PROFILE.crashes || this.now() < state.retryAt)
      throw new VmError('budget')
    if (
      this.active >= VM_PROFILE.maxInstances ||
      (this.active + 1) * VM_PROFILE.memoryBytes > VM_PROFILE.totalMemoryBytes ||
      this.tasks >= VM_PROFILE.globalTasks
    )
      throw new VmError('busy')
    this.active++
    this.tasks++
    state.calls.push(this.now())
    this.calls.push(this.now())
    let released = false
    return (failed = false) => {
      if (released) return
      released = true
      this.active--
      this.tasks--
      if (failed) {
        state.failures.push(this.now())
        state.retryAt =
          this.now() + VM_PROFILE.restartDelaysMs[Math.min(state.failures.length - 1, 2)]!
      }
    }
  }

  get activeCount() {
    return this.active
  }
}
