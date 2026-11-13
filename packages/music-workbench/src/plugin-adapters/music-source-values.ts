import { AppError } from '@any-music/core'
import type { AppErrorCode, Track } from '@any-music/core'
import { PluginCallError } from '@any-music/plugin-sdk'
import type { WireError } from '@any-music/plugin-sdk'
import type { WireTrack } from '@any-music/plugin-sdk/music'
import { assertSchema } from '@any-music/plugin-sdk/schema'

/** Explicit whitelist: account/session values and future host-only fields cannot leak by spread. */
export function trackToWire(track: Track): WireTrack {
  const wire: WireTrack = {
    id: track.id,
    title: track.title,
    artists: track.artists.map((artist) => ({
      name: artist.name,
      ...(artist.id === undefined ? {} : { id: artist.id }),
    })),
    source: {
      pluginId: track.source.pluginId,
      mediaKind: track.source.mediaKind,
      resourceId: track.source.resourceId,
      ...(track.source.partId === undefined ? {} : { partId: track.source.partId }),
      ...(track.source.pageUrl === undefined ? {} : { pageUrl: track.source.pageUrl }),
    },
    ...(track.artworkUrl === undefined ? {} : { artworkUrl: track.artworkUrl }),
    ...(track.durationMs === undefined ? {} : { durationMs: track.durationMs }),
    ...(track.publishedAtMs === undefined ? {} : { publishedAtMs: track.publishedAtMs }),
    ...(track.description === undefined ? {} : { description: track.description }),
    ...(track.sourceTags === undefined ? {} : { sourceTags: [...track.sourceTags] }),
    ...(track.statistics === undefined
      ? {}
      : {
          statistics: {
            ...(track.statistics.playCount === undefined
              ? {}
              : { playCount: track.statistics.playCount }),
            ...(track.statistics.danmakuCount === undefined
              ? {}
              : { danmakuCount: track.statistics.danmakuCount }),
            ...(track.statistics.favoriteCount === undefined
              ? {}
              : { favoriteCount: track.statistics.favoriteCount }),
            ...(track.statistics.commentCount === undefined
              ? {}
              : { commentCount: track.statistics.commentCount }),
            ...(track.statistics.likeCount === undefined
              ? {}
              : { likeCount: track.statistics.likeCount }),
          },
        }),
  }
  assertSchema('WireTrack', wire)
  return wire
}

export function trackFromWire(wire: WireTrack): Track {
  assertSchema('WireTrack', wire)
  // The structural agreement is deliberate, while the copied field whitelist stays explicit.
  return trackToWire(wire)
}

const ERROR_CODES: Record<WireError['code'], AppErrorCode> = {
  'invalid-input': 'invalid-input',
  'unsupported-version': 'unsupported-operation',
  'capability-unavailable': 'unsupported-operation',
  'operation-cancelled': 'operation-cancelled',
  timeout: 'request-timeout',
  'limit-exceeded': 'limit-exceeded',
  'invalid-response': 'invalid-response',
  'upstream-error': 'upstream-error',
  'access-denied': 'access-denied',
  'not-found': 'not-found',
  'rate-limited': 'rate-limited',
  conflict: 'conflict',
  'not-authenticated': 'not-authenticated',
  'account-unavailable': 'account-unavailable',
  'unsupported-url': 'unsupported-url',
  'verification-required': 'verification-required',
  'pagination-unavailable': 'pagination-unavailable',
  'network-error': 'network-error',
}

export function errorFromWire(error: WireError): AppError {
  assertSchema('WireError', error)
  return new AppError(ERROR_CODES[error.code], undefined, { cause: new PluginCallError(error) })
}
