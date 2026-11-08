<script setup lang="ts">
import { CUSTOM_TRACK_PLATFORM_ID } from '@any-music/ui'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { TagDetailView, TagManagementPresentation } from '@any-music/ui/theme'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

import TagDetailsEditor from './TagDetailsEditor.vue'
import TagDetailsHeading from './TagDetailsHeading.vue'

/** Neutral tag navigation; complete themes supply controlled association collections. */
const props = defineProps<{ editor: TagManagementPresentation; suspended?: boolean }>()
defineSlots<{ tracks?: () => unknown; playlists?: () => unknown }>()
const state = computed(() => props.editor.state)
const tag = computed(() => state.value.detailTag)
const view = computed(() => state.value.detailView)
const isPlaylists = computed(() => state.value.entityKind === 'playlists')
const itemName = computed(() => (isPlaylists.value ? '歌单' : '音乐'))
const unit = computed(() => (isPlaylists.value ? '个' : '首'))
const stage = useTemplateRef<HTMLElement>('stage')
const isReturning = shallowRef(false)
const helpOpen = shallowRef(false)
const lastView = shallowRef<TagDetailView>('edit')
const platforms = computed(() => {
  const counts = new Map<string, number>()
  if (isPlaylists.value) {
    for (const record of state.value.detailPlaylists)
      for (const id of new Set(record.platformIds)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  for (const { track } of state.value.detailRecords) {
    const id =
      track.source.mediaKind === 'custom' ? CUSTOM_TRACK_PLATFORM_ID : track.source.pluginId
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return state.value.platformOptions
    .filter(({ id }) => counts.has(id))
    .map(({ id, name }) => ({ id, name, count: counts.get(id)! }))
})
const entries = computed(
  () =>
    [
      { id: 'edit', icon: 'edit', title: '修改标签', description: '修改标签名称，或删除这个标签' },
      {
        id: 'platforms',
        icon: 'library',
        title: '覆盖平台',
        description: `查看 ${platforms.value.length} 个平台的${isPlaylists.value ? '歌单' : '关联歌曲'}数量`,
      },
      {
        id: 'tracks',
        icon: 'music',
        title: `关联${itemName.value}`,
        description: `浏览 ${tag.value?.count ?? 0} ${unit.value}关联${itemName.value}，支持筛选、全选和批量移除标签`,
      },
    ] as const,
)
const currentEntry = computed(() => entries.value.find(({ id }) => id === view.value))
watch(view, (next, previous) => {
  helpOpen.value = false
  isReturning.value = next === 'actions'
  if (next === 'actions') lastView.value = previous
})
watch(tag, (next) => {
  if (!next) helpOpen.value = false
})
function navigate(next: TagDetailView): void {
  props.editor.actions.setDetailView(next)
}
async function focusView(): Promise<void> {
  await nextTick()
  if (props.suspended || state.value.confirming || helpOpen.value) return
  const selector =
    view.value === 'actions'
      ? `[data-tag-detail-entry="${lastView.value}"]`
      : view.value === 'edit'
        ? '[name="tag-detail-name"]'
        : '[data-tag-detail-heading]'
  stage.value?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true })
}
function deactivateView(element: Element): void {
  const root = element.getRootNode()
  const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement
  if (active && element.contains(active))
    element
      .closest('.app-dialog__panel')
      ?.querySelector<HTMLElement>('.app-dialog__close')
      ?.focus({ preventScroll: true })
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}
function activateView(element: Element): void {
  element.removeAttribute('inert')
  element.removeAttribute('aria-hidden')
}
</script>

<template>
  <AppDialog
    class="tag-details-dialog"
    :class="{
      'tag-details-dialog--tracks': view === 'tracks',
      'tag-details-dialog--expanded': view === 'tracks' && (tag?.count ?? 0) > 4,
    }"
    :open="tag !== null"
    :suspended="state.confirming || props.suspended || helpOpen"
    title="标签信息"
    :description="tag ? `#${tag.name}` : undefined"
    :size="view === 'tracks' ? 'wide' : 'compact'"
    :back-action="view === 'actions' ? editor.actions.closeDetail : () => navigate('actions')"
    @close="editor.actions.closeDetail"
  >
    <section
      v-if="tag"
      class="tag-details"
      :class="{ 'tag-details--tracks': view === 'tracks' }"
      aria-label="标签信息"
    >
      <header class="tag-details__summary">
        <AppIcon name="tags" :size="28" />
        <div>
          <h3 class="tag-details__name">#{{ tag.name }}</h3>
          <p>
            关联{{ itemName }} · {{ tag.count }} {{ unit }} · 覆盖 {{ platforms.length }} 个平台
          </p>
        </div>
      </header>
      <div ref="stage" class="tag-details__stage">
        <Transition
          :name="isReturning ? 'tag-details-back' : 'tag-details-forward'"
          @after-enter="focusView"
          @before-enter="activateView"
          @before-leave="deactivateView"
          @leave-cancelled="activateView"
        >
          <div v-if="view === 'actions'" key="actions" class="tag-details__view">
            <button
              v-for="entry in entries"
              :key="entry.id"
              class="tag-details__option"
              type="button"
              :data-tag-detail-entry="entry.id"
              @click="navigate(entry.id)"
            >
              <AppIcon :name="entry.icon" :size="20" />
              <span
                ><strong>{{ entry.title }}</strong
                ><small>{{ entry.description }}</small></span
              >
              <AppIcon name="arrow-right" :size="17" />
            </button>
          </div>
          <div v-else :key="view" class="tag-details__view">
            <TagDetailsHeading
              :title="currentEntry!.title"
              :description="currentEntry!.description"
              :can-delete="view === 'edit'"
              :confirming="state.confirming"
              @help="helpOpen = true"
              @delete="editor.actions.deleteTag(tag.name)"
            />
            <TagDetailsEditor v-if="view === 'edit'" :editor="editor" />
            <section
              v-else-if="view === 'platforms'"
              aria-label="覆盖平台统计"
              class="tag-details__platforms"
            >
              <dl class="tag-details__platform-list">
                <div v-for="platform in platforms" :key="platform.id" class="tag-details__platform">
                  <dt>{{ platform.name }}</dt>
                  <dd>{{ platform.count }} {{ unit }}</dd>
                </div>
              </dl>
              <p v-if="!platforms.length" class="tag-maintenance__hint tag-details__empty">
                这个标签还没有关联{{ itemName }}。
              </p>
              <p class="tag-details__total">
                合计 <strong>{{ tag.count }} {{ unit }}</strong>
              </p>
            </section>
            <slot v-else-if="isPlaylists" name="playlists" />
            <slot v-else name="tracks" />
          </div>
        </Transition>
      </div>
      <p v-if="state.errorMessage" class="tag-details__error" role="alert">
        {{ state.errorMessage }}
      </p>
    </section>
    <template v-if="tag && (view === 'tracks' || view === 'platforms')" #footer>
      <div class="tag-details__footer">
        <button type="button" :disabled="state.confirming" @click="navigate('actions')">
          <AppIcon name="arrow-left" :size="18" />返回
        </button>
        <button
          v-if="view === 'tracks'"
          type="button"
          class="tag-details__remove"
          :disabled="state.confirming || !state.detailSelectedIds.size"
          @click="editor.actions.removeSelectedDetailTags"
        >
          <AppIcon name="trash" :size="18" /><span>移除标签</span
          ><span
            class="tag-details__remove-count"
            :aria-hidden="!state.detailSelectedIds.size"
            :style="{
              inlineSize: state.detailSelectedIds.size
                ? `calc(2em + ${String(state.detailSelectedIds.size).length}ch)`
                : '0px',
            }"
            >（{{ state.detailSelectedIds.size }}）</span
          >
        </button>
      </div>
    </template>
  </AppDialog>
  <AppDialog
    :open="helpOpen"
    :title="`${currentEntry?.title ?? ''}说明`"
    :suspended="state.confirming || props.suspended"
    size="compact"
    @close="helpOpen = false"
  >
    <p class="tag-maintenance__hint">{{ currentEntry?.description }}</p>
  </AppDialog>
</template>

<style scoped lang="scss">
.tag-details {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-4);
}
.tag-details__summary {
  display: flex;
  align-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-3);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface-subtle);
}
.tag-details__summary > .app-icon {
  flex: none;
  color: var(--am-color-primary);
}
.tag-details__summary > div {
  min-inline-size: 0;
}
.tag-details__summary p {
  margin: var(--am-space-1) 0 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  overflow-wrap: anywhere;
}
.tag-details__stage {
  position: relative;
  min-block-size: 220px;
  overflow: hidden;
}
.tag-details__view {
  display: grid;
  min-inline-size: 0;
  align-content: start;
  gap: var(--am-space-2);
}
.tag-details .tag-details__option {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 20px;
  min-block-size: 56px;
  align-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  font-weight: 400;
  text-align: start;
  cursor: pointer;
  transition: background-color var(--am-motion-fast) var(--am-ease-standard);
}
.tag-details__option > span {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-1);
  overflow-wrap: anywhere;
}
.tag-details__option small {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.tag-details__option > .app-icon {
  transition: transform var(--am-motion-fast) var(--am-ease-emphasized);
}
.tag-details__platforms {
  display: grid;
  gap: var(--am-space-3);
  margin-block-start: var(--am-space-2);
}
.tag-details__platform-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--am-space-2);
  margin: 0;
}
.tag-details__platform {
  display: inline-flex;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-2) var(--am-space-3);
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}
.tag-details__platform dt {
  overflow-wrap: anywhere;
}
.tag-details__platform dd {
  flex: none;
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.tag-details__total {
  display: flex;
  justify-content: space-between;
  gap: var(--am-space-3);
  margin: 0;
  padding: var(--am-space-3);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface-subtle);
}
.tag-details__empty {
  text-align: center;
}
.tag-details__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--am-space-3);
}
.tag-details__footer button {
  display: inline-flex;
  min-block-size: 44px;
  align-items: center;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  font-weight: 400;
  cursor: pointer;
}
.tag-details__footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.tag-details__footer .tag-details__remove {
  gap: 0;
  border-color: var(--am-color-danger);
  background: var(--am-color-danger);
  color: var(--am-color-on-danger, white);
}
.tag-details__remove > .app-icon {
  margin-inline-end: var(--am-space-2);
}
.tag-details__remove-count {
  overflow: hidden;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  transition: inline-size var(--am-motion-normal) var(--am-ease-emphasized);
}
.tag-details__footer button:hover:not(:disabled) {
  filter: brightness(0.95);
}
.tag-details__footer button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.tag-details button:not(:disabled):hover {
  background: var(--am-color-surface-hover);
}
.tag-details :is(button, input):focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.tag-details__error {
  color: var(--am-color-danger);
}
:global(.tag-details-dialog--tracks .app-dialog__panel) {
  max-block-size: min(100%, calc(100vh - var(--am-space-4) * 2));
  max-block-size: min(100%, calc(100dvh - var(--am-space-4) * 2));
}
:global(.tag-details-dialog--expanded .app-dialog__panel) {
  inline-size: min(100%, 1440px);
}
/* AppDialog has multiple roots; scope the forwarded class explicitly across that boundary. */
:global(.tag-details-dialog--tracks .app-dialog__content) {
  display: grid;
  overflow: hidden;
}
.tag-details--tracks {
  min-block-size: 0;
  grid-template-rows: auto minmax(0, 1fr);
}
.tag-details--tracks .tag-details__stage {
  display: grid;
  min-block-size: 0;
}
.tag-details--tracks .tag-details__view {
  min-block-size: 0;
  grid-template-rows: auto minmax(0, 1fr);
  align-content: stretch;
}
.tag-details-forward-enter-active,
.tag-details-forward-leave-active,
.tag-details-back-enter-active,
.tag-details-back-leave-active {
  transition:
    transform var(--am-motion-normal) var(--am-ease-emphasized),
    opacity var(--am-motion-normal) var(--am-ease-standard);
}
.tag-details-forward-leave-active,
.tag-details-back-leave-active {
  position: absolute;
  inset: 0;
}
.tag-details-forward-enter-from,
.tag-details-back-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
.tag-details-forward-leave-to,
.tag-details-back-enter-from {
  opacity: 0;
  transform: translateX(-100%);
}
@media (prefers-reduced-motion: no-preference) {
  .tag-details__option:is(:hover, :focus-visible) > .app-icon:first-child {
    transform: rotate(-6deg) scale(1.08);
  }
  .tag-details__option:is(:hover, :focus-visible) > .app-icon:last-child {
    transform: translateX(3px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .tag-details__option,
  .tag-details__option > .app-icon,
  .tag-details__remove-count {
    transition: none;
  }
  .tag-details-forward-enter-active,
  .tag-details-forward-leave-active,
  .tag-details-back-enter-active,
  .tag-details-back-leave-active {
    transition-duration: 1ms;
  }
}
</style>
