import type { WorkbenchRuntime } from '@any-music/music-workbench'

type AudioWindow = Window & { anyMusicAudioBlocked?: number }

/** Native hints carry no authority or device identities. WebView remains the sole focus owner. */
export const androidPlaybackEnvironment: NonNullable<WorkbenchRuntime['playbackEnvironment']> = {
  preferMediaElement: true,
  isBlocked: () =>
    document.visibilityState === 'hidden' || (window as AudioWindow).anyMusicAudioBlocked !== 0,
  subscribeInterruption(listener) {
    const handleNative = (event: Event) => {
      const reason: unknown = (event as CustomEvent).detail
      if (
        reason === 'audio-output' ||
        ((reason === 'background' || reason === 'communication') &&
          androidPlaybackEnvironment.isBlocked())
      )
        listener()
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') listener()
    }
    window.addEventListener('any-music:mobile-audio-interruption', handleNative)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('any-music:mobile-audio-interruption', handleNative)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  },
}
