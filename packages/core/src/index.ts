// 该文件是 core 的稳定公共 API；内部实现路径不应被其他包直接依赖。
export { MAX_TRACK_CUSTOM_NAME_LENGTH, normalizeTrackCustomName } from './library/track-name'
export {
  PLAYLIST_COVER_MAX_EDGE,
  PLAYLIST_COVER_MAX_LENGTH,
  PLAYLIST_COVER_CACHE_MAX_LENGTH,
} from './library/playlist-cover'
export {
  APP_ERROR_DEFINITIONS,
  AppError,
  createAppErrorState,
  formatAppErrorMessage,
  isAppErrorCode,
  normalizeAppError,
  sanitizeAppErrorState,
  toAppErrorState,
} from './errors/app-error'
export type {
  AppErrorCategory,
  AppErrorCode,
  AppErrorDefinition,
  AppErrorSeverity,
  AppErrorState,
  AppErrorStatusCode,
} from './errors/app-error'
export {
  DEFAULT_DOWNLOAD_CONCURRENCY,
  MAX_DOWNLOAD_CONCURRENCY,
  MAX_DOWNLOAD_RETRY_COUNT,
  MIN_DOWNLOAD_CONCURRENCY,
  normalizeDownloadConcurrency,
  runConcurrentDownloads,
} from './download/download-queue'
export {
  createEmptyDownloadHistory,
  deduplicateDownloadBatches,
  DOWNLOAD_HISTORY_SCHEMA_VERSION,
  finalizeInterruptedDownloads,
  sanitizeDownloadHistorySnapshot,
} from './download/download-history'
export type {
  DownloadAttemptHistory,
  DownloadAttemptStatus,
  DownloadBatchStatus,
  DownloadedFileSummary,
  DownloadHistoryBatch,
  DownloadHistoryItem,
  DownloadHistorySnapshot,
  DownloadItemStatus,
  DownloadOrigin,
  DownloadOriginKind,
} from './download/download-history'
export type {
  ConcurrentDownloadResult,
  DownloadCancellationEvent,
  DownloadAttemptEvent,
  DownloadAttemptFailureEvent,
  RunConcurrentDownloadsOptions,
} from './download/download-queue'
export type {
  Track,
  TrackArtist,
  TrackMediaKind,
  TrackSourceReference,
  TrackStatistics,
} from './models/track'
export { MusicSourceError } from './music-source/plugin'
export type {
  CompiledSegmentRecipe,
  CustomTrackSourceCredit,
  CustomTrackDefinition,
  LibraryUserProfile,
  LibraryTrackRecord,
  LocalMusicLibrarySettings,
  LocalMusicLibrarySnapshot,
  HostLocalMusicLibrarySnapshot,
  PublishedCustomTrackAsset,
  MaterialCollection,
  MusicPlaylist,
  PlaybackHistoryEntry,
  SegmentRecipe,
} from './library/models'
export {
  createEmptyLocalMusicLibrary,
  DEFAULT_PLAYBACK_HISTORY_LIMIT,
  LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION,
  MAX_PLAYBACK_HISTORY_LIMIT,
  MIN_PLAYBACK_HISTORY_LIMIT,
} from './library/models'
export {
  assertRecipeUsesMaterialCollection,
  MaterialCollectionError,
} from './library/material-collection'
export type { MaterialCollectionErrorCode } from './library/material-collection'
export { filterFavoriteRecords } from './library/favorites'
export type { FavoriteRecordFilter, FavoriteTrackKind } from './library/favorites'
export {
  compileSegmentRecipe,
  getCompiledDurationMs,
  locateCompiledSegment,
  SegmentRecipeError,
} from './library/segment-recipe'
export type { CompileSegmentRecipeOptions, SegmentRecipeErrorCode } from './library/segment-recipe'
export type {
  CompleteBinaryResolvedMediaSource,
  MediaLoadingStrategy,
  MediaQuality,
  MediaResolveOptions,
  MusicSourceCapabilities,
  MusicSourceAvailability,
  MusicSourceDescriptor,
  MusicSourceErrorCode,
  MusicSourcePlugin,
  MusicSourceImportUrlScope,
  MusicSourceProvenance,
  MusicSourceSession,
  ResolvedMediaSource,
  RemoteResolvedMediaSource,
  TrackImportRequest,
  TrackListing,
  TrackListingContinuation,
  TrackPage,
  TrackSearchRequest,
} from './music-source/plugin'
export { normalizePageSize, selectMediaLoadingStrategy } from './music-source/policies'
export type { PageSizePolicy } from './music-source/policies'
export type { PlaybackMode } from './player/playback-mode'
export { normalizeProgress } from './player/normalize-progress'
export type {
  CancellationSignal,
  HttpClient,
  HttpMethod,
  HttpRequest,
  HttpResponse,
} from './ports/http-client'
export type {
  AccountLoginCapabilities,
  AccountLoginChallenge,
  AccountLoginPort,
} from './ports/account-login'
export { sanitizeTrackAcquisition, sanitizeTrackMetadataUrl } from './models/track'

export { playlistNameKey, validatePlaylistName } from './library/playlist'
