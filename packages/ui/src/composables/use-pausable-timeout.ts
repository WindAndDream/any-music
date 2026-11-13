import { onScopeDispose } from 'vue'

/** Notice replacement restarts the duration while preserving the current interaction pause. */
export function usePausableTimeout(onTimeout: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let remainingMs: number | undefined
  let deadline = 0
  let isPaused = false
  let isDisposed = false

  function clear(): void {
    clearTimeout(timer)
    timer = undefined
    remainingMs = undefined
  }

  function schedule(): void {
    if (isDisposed || isPaused || remainingMs === undefined) return
    deadline = Date.now() + remainingMs
    timer = setTimeout(() => {
      clear()
      onTimeout()
    }, remainingMs)
  }

  function start(durationMs: number): void {
    clear()
    remainingMs = durationMs
    schedule()
  }

  function setPaused(value: boolean): void {
    if (isDisposed || isPaused === value) return
    isPaused = value
    if (isPaused) {
      if (timer !== undefined) {
        remainingMs = Math.max(0, deadline - Date.now())
        clearTimeout(timer)
        timer = undefined
      }
    } else schedule()
  }

  onScopeDispose(() => {
    isDisposed = true
    clear()
  })
  return { start, clear, setPaused }
}
