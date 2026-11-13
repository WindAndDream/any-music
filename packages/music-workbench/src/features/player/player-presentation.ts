import type { UiPlayerState } from '@any-music/ui/theme'
import { computed } from 'vue'

import type { AudioPlayerController } from './use-audio-player'

/** Project the existing controller without exposing media ownership or lifecycle ports. */
export function createPlayerPresentationState(player: AudioPlayerController) {
  return computed<UiPlayerState>(() => ({
    positionMs: player.displayedPositionMs.value,
    durationMs: player.displayedDurationMs.value,
    bufferedUntilMs: player.displayedBufferedUntilMs.value,
    playing: player.displayedIsPlaying.value,
    seekDisabled: player.isSeekDisabled.value,
    playbackRate: player.playbackRate.value,
    volume: player.volume.value,
    qualityOptions: player.qualityOptions.value,
    selectedQualityId: player.selectedQualityId.value,
    status: player.status.value,
    statusLabel: player.statusLabel.value,
  }))
}
