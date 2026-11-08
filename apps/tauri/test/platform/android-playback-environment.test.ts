import { afterEach, describe, expect, it, vi } from 'vitest'

import { androidPlaybackEnvironment as environment } from '../../src/platform/android-playback-environment'

afterEach(() => vi.unstubAllGlobals())
describe('Android playback interruptions', () => {
  it('waits for the native foreground state after a new document loads', () => {
    const window = {} as { anyMusicAudioBlocked?: number }
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', { visibilityState: 'visible' })
    expect(environment.isBlocked()).toBe(true)
    window.anyMusicAudioBlocked = 2
    expect(environment.isBlocked()).toBe(true)
    window.anyMusicAudioBlocked = 0
    expect(environment.isBlocked()).toBe(false)
  })
  it('blocks hidden/communication playback and never replays on availability', () => {
    const window = Object.assign(new EventTarget(), { anyMusicAudioBlocked: 0 })
    const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', document)
    const interrupt = vi.fn()
    const dispose = environment.subscribeInterruption(interrupt)
    expect(environment.isBlocked()).toBe(false)
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(interrupt).toHaveBeenCalledOnce()
    expect(environment.isBlocked()).toBe(true)
    document.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(interrupt).toHaveBeenCalledOnce()
    window.anyMusicAudioBlocked = 2
    window.dispatchEvent(
      new CustomEvent('any-music:mobile-audio-interruption', { detail: 'communication' }),
    )
    expect(interrupt).toHaveBeenCalledTimes(2)
    window.anyMusicAudioBlocked = 0
    window.dispatchEvent(
      new CustomEvent('any-music:mobile-audio-interruption', { detail: 'communication' }),
    )
    expect(interrupt).toHaveBeenCalledTimes(2)
    window.dispatchEvent(
      new CustomEvent('any-music:mobile-audio-interruption', { detail: 'audio-output' }),
    )
    expect(interrupt).toHaveBeenCalledTimes(3)
    dispose()
    window.dispatchEvent(
      new CustomEvent('any-music:mobile-audio-interruption', { detail: 'audio-output' }),
    )
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(interrupt).toHaveBeenCalledTimes(3)
  })
})
