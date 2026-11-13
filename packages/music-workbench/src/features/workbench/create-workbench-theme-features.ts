import type { AppShellPreferences } from '@any-music/ui'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, readonly } from 'vue'

import { getWorkbenchRuntime } from '../../runtime/workbench-runtime'
import { createWorkbenchSpecialistFeatures } from './create-workbench-specialist-features'
import { createWorkbenchTrackFeatures } from './create-workbench-track-features'
import type { WorkbenchController, WorkbenchProps } from './use-workbench-controller'

/** Production complete-root projection; called once above all replaceable theme trees. */
export function createWorkbenchThemeFeatures(
  c: WorkbenchController,
  props: Readonly<WorkbenchProps>,
) {
  const collections = createWorkbenchTrackFeatures(c)
  const specialist = createWorkbenchSpecialistFeatures(
    c,
    collections.displayDefaults,
    computed(() => collections.features.value.playlists.state.coverUrls ?? {}),
  )
  const history = c.catalogFilterHistory
  const runtime = getWorkbenchRuntime()
  const preferences = computed<AppShellPreferences>(() => ({
    schemaVersion: 1,
    sidebarSide: c.sidebarSide.value,
    isSidebarCollapsed: c.isSidebarCollapsed.value,
    isMobileNavigationEnabled: c.isMobileNavigationEnabled.value,
    theme: c.theme.value,
    destinationOrder: c.destinationOrder.value,
    hiddenDestinationIds: c.hiddenDestinationIds.value,
  }))
  const destinations = computed(() =>
    c.preferenceDestinations.value.filter(({ id }) => c.modules.canOpenView(id)),
  )
  const available = { status: 'available' as const }
  const ready = { status: 'ready' as const }
  const navigate = (id: Parameters<typeof c.selectTab>[0]) => {
    if (c.modules.canOpenView(id)) c.handleSelectNavigation(id)
  }
  const features = computed<UiThemeFeatureMap>(() => ({
    ...collections.features.value,
    ...specialist,
    catalog: {
      ...collections.features.value.catalog,
      state: {
        ...collections.features.value.catalog.state,
        accountMissing: props.accountMissing?.includes(c.registry.activePluginId.value) ?? false,
        drawers: collections.features.value.catalog.state.drawers.map((drawer) => ({
          ...drawer,
          accountStatus:
            drawer.accountStatusVisible && drawer.account?.id && props.accountStatuses
              ? (props.accountStatuses[drawer.account.id] ?? '已删除')
              : undefined,
        })),
      },
      actions: {
        ...collections.features.value.catalog.actions,
        notifyMissingAccount: () =>
          c.actionFeedback.show({
            status: 'error',
            message: '此平台尚未添加账号，请先在账号管理中添加。',
          }),
        submit: async () => {
          if (props.accountMissing?.includes(c.registry.activePluginId.value)) {
            c.actionFeedback.show({
              status: 'error',
              message: '此平台尚未添加账号，请先在账号管理中添加。',
            })
            return
          }
          await collections.features.value.catalog.actions.submit()
        },
      },
    },
    shell: {
      availability: available,
      status: ready,
      state: {
        activeViewId: c.activeTab.value,
        destinations: destinations.value,
        hidden: c.isProductHidden.value,
        description: c.activeDescription.value,
        presentation: props.presentation ?? 'overlay',
        canHide: c.canHideProduct,
        resolvedTheme: c.resolvedTheme.value,
        mobileLayout: c.isMobileViewport.value,
      },
      actions: {
        navigate,
        hide: c.hideProduct,
        show: c.showProduct,
        openSettings: (section) => c.openGlobalSettings(section),
      },
    },
    navigation: {
      availability: available,
      status: ready,
      state: {
        activeViewId: c.activeTab.value,
        destinations: destinations.value,
        preferences: preferences.value,
        effectiveSidebarCollapsed: c.effectiveSidebarCollapsed.value,
      },
      actions: {
        navigate,
        setPreferences: c.setPreferences,
        toggleSidebar: c.toggleSidebarCollapsed,
      },
    },
    player: {
      availability: available,
      status: c.player.errorState.value
        ? { status: 'error', error: c.player.errorState.value }
        : { status: c.player.status.value === 'resolving' ? 'loading' : 'ready' },
      state: {
        track: c.playerTrack.value ?? null,
        playing: c.player.displayedIsPlaying.value,
        positionMs: c.player.displayedPositionMs.value,
        bufferedUntilMs: c.player.displayedBufferedUntilMs.value,
        statusLabel: c.player.statusLabel.value,
        durationMs: c.player.displayedDurationMs.value ?? 0,
        volume: c.player.volume.value,
        playbackRate: c.player.playbackRate.value,
        mode: c.queue.mode.value,
        quality: c.player.qualityOptions.value.find(
          ({ id }) => id === c.player.selectedQualityId.value,
        ) ??
          c.player.qualityOptions.value[0] ?? { id: 'auto', label: '自动', rank: 0 },
        qualities: c.player.qualityOptions.value,
        canSeek: !c.player.isSeekDisabled.value,
        canDownload: Boolean(c.playerTrack.value) && !c.downloadBusy.value,
      },
      actions: {
        play: async () => {
          if (!c.player.displayedIsPlaying.value) await c.player.toggleCustomPlayback()
        },
        pause: () => {
          if (c.player.displayedIsPlaying.value) void c.player.toggleCustomPlayback()
        },
        previous: c.handlePlayerPrevious,
        next: c.handlePlayerNext,
        seek: c.player.handlePrecisionSeek,
        setVolume: c.player.setVolume,
        setPlaybackRate: c.player.setPlaybackRate,
        setMode: c.updateMode,
        setQuality: (quality) => c.player.selectQuality(quality.id),
        download: () => {
          if (c.playerTrack.value) c.downloadPlayerTrack(c.playerTrack.value)
        },
        retry: c.player.retry,
      },
    },
    settings: {
      availability: available,
      status: ready,
      state: {
        section: c.initialSettingsSection.value,
        open: c.isGlobalSettingsOpen.value,
        isMobileLayout: c.isMobileViewport.value,
        suspended: c.isConfirmationDialogOpen.value || Boolean(props.accountDialogOpen),
        destinations: c.preferenceDestinations.value,
        sources: c.registry.plugins.value.map(({ descriptor }) => descriptor),
        enabledSourceIds: c.workspace.configuredEnabledPluginIds.value,
        availabilityBySourceId: c.registry.availabilityByPluginId.value,
        externalSourcesEnabled: c.externalSourcesEnabled.value,
        profileId: c.library.profile.value.id,
        networkSummary:
          props.networkSummary ?? (c.workspace.proxySettings.value.isEnabled ? '已启用' : '未启用'),
        accountSummary: props.accountSummary,
        networkTitle: props.networkTitle,
        networkDescription: props.networkDescription,
        appearance: c.theme.value,
        themeId: c.uiTheme.current.value.theme.definition.id,
        themeError: c.uiTheme.error.value,
        themes: runtime.themes?.themes.map(({ descriptor }) => descriptor) ?? [],
        preferences: preferences.value,
        playbackHistoryLimit: c.library.historyLimit.value,
        downloadConcurrency: c.workspace.downloadConcurrency.value,
        creatorDisplayName: c.library.profile.value.displayName,
        filterHistory: history.settings.value,
        displayDefaults: collections.displayDefaults.value,
      },
      actions: {
        close: () => {
          c.isGlobalSettingsOpen.value = false
        },
        selectSection: (section) => {
          c.initialSettingsSection.value = section
        },
        setSourceEnabled: c.setPluginEnabled,
        checkSource: c.checkPlugin,
        setAppearance: c.setTheme,
        selectTheme: c.uiTheme.select,
        setPreferences: c.setPreferences,
        setPlaybackHistoryLimit: c.setHistoryLimit,
        setDownloadConcurrency: c.setDownloadConcurrency,
        setCreatorDisplayName: c.updateLocalUserDisplayName,
        setFilterHistory: history.setSettings,
        setDisplayDefault: collections.setDisplayDefault,
      },
    },
    overlays: {
      availability: available,
      status: ready,
      state: {
        active: c.confirmationDialog.activeRequest.value
          ? { kind: 'confirmation', ...c.confirmationDialog.activeRequest.value }
          : collections.actionTrack.value
            ? { kind: 'track-actions', trackId: collections.actionTrack.value }
            : null,
        notice: c.actionFeedback.notice.value
          ? {
              message: c.actionFeedback.notice.value.message,
              tone: c.actionFeedback.notice.value.tone,
            }
          : c.playbackNotice.message.value
            ? { message: c.playbackNotice.message.value, tone: 'info' }
            : null,
      },
      actions: {
        close: (requestId) => {
          if (c.confirmationDialog.activeRequest.value) {
            if (requestId === c.confirmationDialog.activeRequest.value.id)
              c.confirmationDialog.cancel()
          } else collections.actionTrack.value = undefined
        },
        confirm: (id) => {
          if (id === c.confirmationDialog.activeRequest.value?.id) c.confirmationDialog.accept()
        },
        dismissNotice: () => {
          c.actionFeedback.dismiss()
          c.playbackNotice.dismiss()
        },
        setNoticePaused: (isPaused) => {
          c.actionFeedback.setPaused(isPaused)
          c.playbackNotice.setPaused(isPaused)
        },
      },
    },
  }))
  // readonly wraps values and collections without exposing controller mutation/disposal ports.
  return computed(() => readonly(features.value))
}
