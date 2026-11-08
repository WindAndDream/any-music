import { useGlobalSettings } from '@any-music/ui'
import type { GlobalSettingsEmits, GlobalSettingsProps } from '@any-music/ui'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed } from 'vue'

/** Reuse neutral settings cells and validation so drafts also survive cross-theme replacement. */
export function useStudioSettings(props: { readonly feature: UiThemeFeatureMap['settings'] }) {
  const state = computed(() => props.feature.state)
  const settings: GlobalSettingsProps = {
    get plugins() {
      return state.value.sources.map((descriptor) => ({ descriptor }))
    },
    get availabilityByPluginId() {
      return state.value.availabilityBySourceId
    },
    get enabledPluginIds() {
      return state.value.enabledSourceIds
    },
    get externalSourcesEnabled() {
      return state.value.externalSourcesEnabled
    },
    get profile() {
      return { id: state.value.profileId, displayName: state.value.creatorDisplayName }
    },
    get historyLimit() {
      return state.value.playbackHistoryLimit
    },
    get downloadConcurrency() {
      return state.value.downloadConcurrency
    },
    get suspended() {
      return (
        state.value.suspended ||
        !state.value.open ||
        props.feature.availability.status !== 'available'
      )
    },
  }
  const callbacks = {
    setPluginEnabled: (id: string, enabled: boolean) =>
      props.feature.actions.setSourceEnabled(id, enabled),
    checkPlugin: (id: string) => {
      void props.feature.actions.checkSource(id)
    },
    setHistoryLimit: (value: number) => props.feature.actions.setPlaybackHistoryLimit(value),
    setDownloadConcurrency: (value: number) => props.feature.actions.setDownloadConcurrency(value),
    updateLocalUserDisplayName: (value: string) =>
      props.feature.actions.setCreatorDisplayName(value),
    detailOpenChange: (_open: boolean) => {},
    selectSection: (section: UiThemeFeatureMap['settings']['state']['section']) =>
      props.feature.actions.selectSection(section),
  } satisfies { [Key in keyof GlobalSettingsEmits]: (...args: GlobalSettingsEmits[Key]) => void }
  function emit<Key extends keyof GlobalSettingsEmits>(
    event: Key,
    ...args: GlobalSettingsEmits[Key]
  ) {
    const callback = callbacks[event] as (...values: GlobalSettingsEmits[Key]) => void
    callback(...args)
  }
  return { state, ...useGlobalSettings({ props: settings, emit }) }
}
