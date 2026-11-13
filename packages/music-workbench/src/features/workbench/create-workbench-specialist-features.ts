import type { CollectionDisplayDefaults } from '@any-music/ui'
import { CUSTOM_TRACK_PLATFORM_ID } from '@any-music/ui'
import type {
  MusicCreationPresentation,
  SpecialistEditor,
  TagManagementPresentation,
  UiThemeFeatureMap,
  UiThemeStatus,
  UiPluginCenterItem,
} from '@any-music/ui/theme'
import type { ComputedRef } from 'vue'
import { computed, defineComponent, h, markRaw } from 'vue'

import type { WorkbenchController } from './use-workbench-controller'

/** Bind each renderless editor to its originating plugin session, including delayed events. */
export function createWorkbenchSpecialistFeatures(
  controller: WorkbenchController,
  displayDefaults?: ComputedRef<CollectionDisplayDefaults>,
  playlistCoverUrls?: ComputedRef<Readonly<Record<string, string>>>,
): Pick<UiThemeFeatureMap, 'tags' | 'composer' | 'plugins'> {
  const tags = controller.tagManagement
  const creation = controller.musicCreation
  const tagPlaylists = computed(() => {
    const records = new Map(
      controller.library.records.value.map((record) => [record.track.id, record]),
    )
    return controller.library.playlists.value.map((playlist) => ({
      playlist,
      customTags: tags.tagsByPlaylistId.value.get(playlist.id) ?? [],
      platformIds: [
        ...new Set(
          playlist.trackIds.flatMap((id) => {
            const track = records.get(id)?.track
            return track
              ? [
                  track.source.mediaKind === 'custom'
                    ? CUSTOM_TRACK_PLATFORM_ID
                    : track.source.pluginId,
                ]
              : []
          }),
        ),
      ],
      coverUrl: playlist.coverId ? playlistCoverUrls?.value[playlist.coverId] : undefined,
    }))
  })
  const tagEditor = computed(() => {
    const Adapter = tags.Panel.value
    const editing = tags.editing.value
    const actions = controller.tagPageActions.value
    if (!Adapter || !editing || !actions) return null
    return markRaw(
      defineComponent({
        name: 'HostTagEditor',
        setup:
          (_, { slots }) =>
          () =>
            h(
              Adapter,
              {
                editing,
                defaultDisplayMode:
                  displayDefaults?.value.tags?.tracks?.layout === 'rows' ? 'rows' : 'fill',
                defaultTrackDisplayPreferences: displayDefaults?.value.tags?.['associated-tracks'],
                tagDefinitions: tags.tagDefinitions.value,
                createTag: actions.createTag,
                removeTagAssociations: actions.removeTagAssociations,
                records: controller.library.records.value,
                playlists: tagPlaylists.value,
                platforms: controller.favoritePlatforms.value,
                errorMessage: controller.localError.value,
                onAddTag: actions.addTag,
                onRemoveTag: actions.removeTag,
                onRenameTag: actions.renameTag,
                onDeleteTag: actions.deleteTag,
                onDeleteTags: actions.deleteTags,
                onMergeTags: actions.mergeTags,
              },
              slots,
            ),
      }),
    ) as SpecialistEditor<TagManagementPresentation>
  })
  const creationEditor = computed(() => {
    const Adapter = creation.Composer.value
    const editing = creation.editing.value
    const actions = controller.creationPageActions.value
    // Publish/clear resets transient editing cells without replacing the business session.
    void controller.composerGeneration.value
    if (!Adapter || !editing || !actions) return null
    return markRaw(
      defineComponent({
        name: 'HostCreationEditor',
        setup:
          (_, { slots }) =>
          () =>
            h(
              Adapter,
              {
                editing,
                draft: creation.state.value.draft,
                records: controller.library.records.value,
                pendingRecords: controller.creationPendingRecords.value,
                materialCollections: creation.state.value.materialCollections,
                platforms: controller.favoritePlatforms.value,
                errorMessage: controller.featureError.value,
                exportBusy: controller.downloadBusy.value,
                exportMessage: controller.exportMessage.value,
                onCreateCollection: actions.createCollection,
                onDeleteCollection: actions.deleteCollection,
                onRemovePendingMaterial: actions.removePendingMaterial,
                onAddMaterial: actions.addMaterial,
                onRemoveMaterial: actions.removeMaterial,
                onUpdateDraft: actions.updateDraft,
                onClearData: actions.clearData,
                onSave: actions.save,
                onPreview: actions.preview,
                onDownload: actions.download,
              },
              slots,
            ),
      }),
    ) as SpecialistEditor<MusicCreationPresentation>
  })
  const tagStatus = (): UiThemeStatus =>
    tags.error.value
      ? { status: 'error', error: tags.error.value }
      : { status: tags.loading.value ? 'loading' : 'ready' }
  const creationStatus = (): UiThemeStatus =>
    creation.error.value
      ? { status: 'error', error: creation.error.value }
      : { status: creation.loading.value ? 'loading' : 'ready' }
  const feature = <Model>(
    id: string,
    editor: () => SpecialistEditor<Model> | null,
    available: () => boolean,
    status: () => UiThemeStatus,
    retry: () => Promise<void>,
  ) => ({
    state: {
      get Editor() {
        return editor()
      },
    },
    actions: { retry },
    get availability() {
      return available()
        ? { status: 'available' as const }
        : {
            status: controller.modules.isEnabled(id)
              ? ('unavailable' as const)
              : ('disabled' as const),
            reason: '功能未启用或尚未就绪，数据已保留。',
          }
    },
    get status() {
      return status()
    },
  })
  return {
    tags: feature(
      'feature.tags',
      () => tagEditor.value,
      () => tags.available.value,
      tagStatus,
      tags.retry,
    ),
    composer: feature(
      'feature.composer',
      () => creationEditor.value,
      () => creation.available.value,
      creationStatus,
      creation.retry,
    ),
    plugins: {
      state: {
        get defaultDisplay() {
          return displayDefaults?.value.plugins?.tracks?.layout === 'list'
            ? ('list' as const)
            : ('grid' as const)
        },
        get items() {
          const sources: UiPluginCenterItem[] = controller.registry.plugins.value
            .filter(({ descriptor }) => descriptor.provenance === 'built-in')
            .map(({ descriptor }) => ({
              id: descriptor.id,
              name: descriptor.name,
              description: `连接${descriptor.name}的音乐内容，在发现中搜索或导入列表。`,
              origin: 'builtin',
              category: '音乐源',
              enabled: controller.workspace.isPluginEnabled(descriptor.id),
              developmentStatus: controller.modules.getDevelopmentStatus(descriptor.id),
              unavailableReason: controller.modules.getUnavailableReason(descriptor.id),
              status: { status: 'ready' },
            }))
          return [
            ...sources,
            {
              id: 'feature.tags',
              name: '标签管理',
              description: '为音乐添加标签，按标签筛选、整理收藏与创作素材。',
              origin: 'builtin' as const,
              category: '资料整理',
              enabled: controller.modules.isEnabled('feature.tags'),
              developmentStatus: controller.modules.getDevelopmentStatus('feature.tags'),
              unavailableReason: controller.modules.getUnavailableReason('feature.tags'),
              status: tagStatus(),
            },
            {
              id: 'feature.composer',
              name: '片段创作（含自定义音乐）',
              description: '剪取音乐片段、编排素材，将灵感组合为自己的音乐作品。',
              origin: 'builtin' as const,
              category: '音乐创作',
              enabled: controller.modules.isEnabled('feature.composer'),
              developmentStatus: controller.modules.getDevelopmentStatus('feature.composer'),
              unavailableReason: controller.modules.getUnavailableReason('feature.composer'),
              status: creationStatus(),
            },
            ...controller.pluginCenter.installs.value.map((install): UiPluginCenterItem => ({
              id: install.installId,
              name: `${install.dev ? '[DEV] ' : ''}${install.pluginId}`,
              description: install.contributions?.includes('music.sources')
                ? '向发现提供音乐目录，可在管理中查看贡献与授权范围。当前不提供媒体解析。'
                : '扩展音乐工作台，可在管理中查看可用命令与授权范围。',
              origin: 'external',
              category: install.contributions?.includes('music.sources') ? '音乐源' : '功能扩展',
              enabled: install.enabled,
              status: { status: 'ready' },
              publisher: install.publisher,
              generation: install.generation,
            })),
          ]
        },
        get externalSupported() {
          return Boolean(controller.externalSourcesEnabled.value && controller.nativePluginPort)
        },
        get busy() {
          return controller.pluginCenter.busy.value
        },
        get errorMessage() {
          return controller.pluginCenter.errorMessage.value
        },
      },
      actions: {
        setEnabled: async (id, enabled) => {
          if (
            enabled &&
            controller.actionFeedback.showUnavailable(controller.modules.getUnavailableReason(id))
          )
            return
          if (id === 'feature.tags' || id === 'feature.composer')
            await controller.modules.setEnabled(id, enabled)
          else if (
            controller.registry.plugins.value.some(
              ({ descriptor }) => descriptor.id === id && descriptor.provenance === 'built-in',
            )
          )
            await controller.setPluginEnabled(id, enabled)
        },
        retry: async (id) => {
          if (id === 'feature.tags') await tags.retry()
          if (id === 'feature.composer') await creation.retry()
        },
        importPlugin: () => {
          if (controller.externalSourcesEnabled.value && controller.nativePluginPort)
            controller.openGlobalSettings('external-sources')
        },
        manageExternal: (id) => {
          if (controller.pluginCenter.installs.value.some((install) => install.installId === id))
            controller.openGlobalSettings('external-sources')
        },
        refresh: async () => {
          await controller.pluginCenter.authority.value?.refresh()
        },
      },
      availability: { status: 'available' },
      get status(): UiThemeStatus {
        const error = controller.workspace.actionErrorState.value
        return error ? { status: 'error', error } : { status: 'ready' }
      },
    },
  }
}
