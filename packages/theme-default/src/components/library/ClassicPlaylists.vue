<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import PlaylistValidationNotice from '@any-music/ui/components/PlaylistValidationNotice.vue'
import {
  useCollectionNavigation,
  useConfirmAction,
  useEditingSession,
  usePlaylistEditorDraft,
} from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, nextTick, useTemplateRef, watch } from 'vue'

import { usePresentationActivity } from '../../composables/use-presentation-activity'
import ClassicPageOverlays from '../overlays/ClassicPageOverlays.vue'
import ClassicFeatureStatus from './ClassicFeatureStatus.vue'
import ClassicPlaylistOverview from './ClassicPlaylistOverview.vue'
import ClassicTrackCollection from './ClassicTrackCollection.vue'
import PlaylistEditorDialog from './PlaylistEditorDialog.vue'

const props = defineProps<{ feature: UiThemeFeatureMap['playlists'] }>()
const state = computed(() => props.feature.state)
const active = computed(() =>
  state.value.playlists.find(({ id }) => id === state.value.activePlaylistId),
)
const editorDraft = usePlaylistEditorDraft()
const editor = editorDraft.id
const details = computed(() => state.value.playlists.find(({ id }) => id === editor.value))
const page = useTemplateRef<HTMLElement>('page')
const navigation = useCollectionNavigation({
  editing: useEditingSession('playlist-overview'),
  enabled: true,
  entryIds: () => state.value.playlists.map(({ id }) => id),
  scrollContainer: () => page.value?.closest<HTMLElement>('.music-app-shell__content') ?? null,
})
watch(
  () => state.value.activePlaylistId,
  (id) => (id ? navigation.open(id) : navigation.back()),
  { immediate: true },
)
watch(navigation.activeId, (id) => {
  if ((id ?? null) !== state.value.activePlaylistId) props.feature.actions.open(id ?? null)
})
const confirm = useConfirmAction()
const activity = usePresentationActivity()
function edit(id: string | null = null) {
  props.feature.actions.setNameDraft(
    id ? (state.value.playlists.find((item) => item.id === id)?.name ?? '') : '',
  )
  editorDraft.description.value = id
    ? (state.value.playlists.find((item) => item.id === id)?.description ?? '')
    : ''
  editorDraft.cover.value = undefined
  editorDraft.field.value = null
  editorDraft.tag.value = ''
  editor.value = id ?? 'create'
}
async function remove(id: string) {
  const playlist = state.value.playlists.find((item) => item.id === id)
  if (!playlist) return
  const current = activity.checkpoint()
  if (
    await confirm({
      title: '删除歌单',
      message: `确定删除歌单“${playlist.name}”吗？歌单内歌曲和“我的喜欢”不会被删除。`,
      tone: 'danger',
    })
  ) {
    if (current() && props.feature.availability.status === 'available' && editor.value === id) {
      await props.feature.actions.remove(id)
      if (current() && editor.value === id) editor.value = null
    }
  }
}
function leave(view: Element) {
  const root = view.getRootNode() as Document | ShadowRoot
  if (root.activeElement && view.contains(root.activeElement))
    page.value?.focus({ preventScroll: true })
  view.setAttribute('inert', '')
  view.setAttribute('aria-hidden', 'true')
}
function enter(view: Element) {
  view.removeAttribute('inert')
  view.removeAttribute('aria-hidden')
  navigation.prepareTransition(view)
}
async function finish(view: Element) {
  await nextTick()
  if (view.isConnected && view.getAttribute('inert') === null)
    navigation.finishTransition(view, { restoreFocus: !editor.value })
}
</script>

<template>
  <section ref="page" class="listen-queue playlist-page" aria-label="我的歌单" tabindex="-1">
    <ClassicFeatureStatus :availability="feature.availability" :status="feature.status" />
    <PlaylistValidationNotice
      v-if="active"
      :validation="state.validation"
      @retry="feature.actions.retryValidation?.()"
    />
    <fieldset class="listen-queue__fields" :disabled="feature.availability.status !== 'available'">
      <div class="listen-queue__content playlist-page__content">
        <Transition
          :name="`queue-view-${navigation.direction.value}`"
          @before-leave="leave"
          @before-enter="enter"
          @after-enter="finish"
          @leave-cancelled="enter"
        >
          <div
            :key="active?.id ?? 'overview'"
            class="playlist-page__view"
            :data-collection-view="navigation.viewKey.value"
          >
            <ClassicPlaylistOverview
              v-if="!active"
              :feature="feature"
              :suspended="editor !== null"
              @open="feature.actions.open"
              @create="edit()"
              @details="edit"
            />
            <ClassicTrackCollection
              v-else
              :key="active.id"
              :scope="`playlist:${active.id}`"
              :title="active.name"
              :state="state"
              :actions="feature.actions"
              :availability="feature.availability"
              :status="feature.status"
              :collection="feature"
              :remove="(ids) => feature.actions.removeTracks(active!.id, ids)"
            >
              <template #navigation>
                <button
                  class="playlist-page__back"
                  type="button"
                  aria-label="返回我的歌单"
                  title="返回我的歌单"
                  @click="feature.actions.open(null)"
                >
                  <AppIcon name="arrow-left" :size="18" /><span class="playlist-page__back-label"
                    >我的歌单</span
                  >
                </button>
              </template>
              <template #collection-actions="{ compact }">
                <button
                  class="playlist-page__info"
                  :class="{ 'playlist-page__info--compact': compact }"
                  type="button"
                  :disabled="feature.availability.status !== 'available'"
                  aria-label="歌单信息"
                  title="歌单信息"
                  aria-haspopup="dialog"
                  @click="edit(active.id)"
                >
                  <AppIcon name="info" :size="compact ? 18 : 16" /><span v-if="!compact"
                    >歌单信息</span
                  >
                </button>
              </template>
            </ClassicTrackCollection>
          </div>
        </Transition>
      </div>
    </fieldset>
    <ClassicPageOverlays :modal-open="editor !== null">
      <PlaylistEditorDialog
        v-if="editor && (editor === 'create' || details)"
        :key="editor"
        :feature="feature"
        :playlist="details"
        @close="editor = null"
        @remove="remove"
      />
    </ClassicPageOverlays>
  </section>
</template>

<style scoped>
.playlist-page__view {
  grid-area: 1 / 1;
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  min-inline-size: 0;
}
.playlist-page__view[aria-hidden='true'] {
  pointer-events: none;
}
.playlist-page__back,
.playlist-page__info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  gap: var(--am-space-2);
  min-block-size: 44px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: 650 var(--am-font-size-xs) var(--am-font-family);
  white-space: nowrap;
  cursor: pointer;
  touch-action: manipulation;
}
.playlist-page__back:is(:hover, :focus-visible):not(:disabled),
.playlist-page__info:is(:hover, :focus-visible):not(:disabled) {
  background: var(--am-color-surface-hover);
}
.playlist-page__back:focus-visible,
.playlist-page__info:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.playlist-page__info:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.playlist-page__info {
  min-block-size: 36px;
  font-weight: 700;
}
.playlist-page__info--compact {
  inline-size: 36px;
  min-inline-size: 36px;
  min-block-size: 36px;
  padding-inline: 0;
}
@container am-catalog-heading (max-width: 760px) {
  .playlist-page__back {
    inline-size: 44px;
    padding-inline: 0;
  }
  .playlist-page__back-label {
    display: none;
  }
}
</style>
