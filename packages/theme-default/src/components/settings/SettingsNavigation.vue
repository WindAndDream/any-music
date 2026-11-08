<script setup lang="ts">
import { useSettingsNavigation } from '@any-music/ui'
import type { SettingsNavigationProps, SettingsSectionId } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { useId, useTemplateRef } from 'vue'

/** PC 分类导航与手机两页滑入共用同一组设置契约，隐藏页面立即退出交互与焦点序列。 */
const props = defineProps<SettingsNavigationProps>()
const emit = defineEmits<{ selectSection: [section: SettingsSectionId | null] }>()
defineSlots<
  Partial<Record<SettingsSectionId, () => unknown>> & {
    'header-actions'?: (context: { section: SettingsSectionId }) => unknown
  }
>()

const accessibleId = useId()
const navigation = useTemplateRef<HTMLElement>('navigation')
const detail = useTemplateRef<HTMLElement>('detail')
const {
  selectedEntry,
  selectedSectionId,
  displayedSectionId,
  visitedSectionIds,
  openSection,
  returnToOverview,
} = useSettingsNavigation({
  props,
  navigation,
  detail,
  onSelectSection: (id) => emit('selectSection', id),
})
</script>

<template>
  <div
    class="settings-navigation"
    :class="{ 'settings-navigation--mobile': props.isMobileLayout }"
    :data-detail-open="selectedSectionId !== null"
  >
    <div class="settings-navigation__stage">
      <nav
        ref="navigation"
        data-am-scroll-key="settings:overview"
        class="settings-navigation__overview"
        aria-label="设置分类"
        :inert="props.isMobileLayout && selectedSectionId !== null ? true : undefined"
        :aria-hidden="props.isMobileLayout && selectedSectionId !== null ? 'true' : undefined"
      >
        <section v-for="group in props.groups" :key="group.id" class="settings-navigation__group">
          <h3 :id="`${accessibleId}-${group.id}`">{{ group.title }}</h3>
          <div
            class="settings-navigation__entries"
            role="group"
            :aria-labelledby="`${accessibleId}-${group.id}`"
          >
            <button
              v-for="entry in group.entries"
              :key="entry.id"
              class="settings-navigation__entry"
              type="button"
              :data-settings-entry="entry.id"
              :data-am-focus-key="`settings:${entry.id}`"
              :aria-current="selectedSectionId === entry.id ? 'page' : undefined"
              :aria-controls="`${accessibleId}-detail`"
              @click="openSection(entry.id)"
            >
              <span class="settings-navigation__icon"
                ><AppIcon :name="entry.icon" :size="20"
              /></span>
              <span class="settings-navigation__entry-copy">
                <strong>{{ entry.title }}</strong>
                <small v-if="entry.summary">{{ entry.summary }}</small>
              </span>
              <AppIcon class="settings-navigation__chevron" name="arrow-right" :size="18" />
            </button>
          </div>
        </section>
      </nav>

      <section
        :id="`${accessibleId}-detail`"
        ref="detail"
        :data-am-scroll-key="`settings:${displayedSectionId}`"
        class="settings-navigation__detail"
        :aria-label="selectedEntry?.title ?? '设置详情'"
        :inert="selectedSectionId === null ? true : undefined"
        :aria-hidden="selectedSectionId === null ? 'true' : undefined"
      >
        <header class="settings-navigation__header">
          <h3
            tabindex="-1"
            data-settings-heading
            :data-am-focus-key="`settings:${displayedSectionId}:heading`"
          >
            {{ selectedEntry?.title }}
          </h3>
          <div class="settings-navigation__header-actions">
            <slot v-if="displayedSectionId" name="header-actions" :section="displayedSectionId" />
            <button
              v-if="props.isMobileLayout"
              class="settings-navigation__back"
              type="button"
              aria-label="返回设置"
              data-am-focus-key="settings:back"
              @click="returnToOverview"
            >
              <AppIcon name="arrow-left" :size="20" />
              <span>设置</span>
            </button>
          </div>
          <p>{{ selectedEntry?.description }}</p>
        </header>
        <!-- 只在首次访问时挂载，返回/切换保留未提交内容；hidden 防止多页表单进入焦点圈。 -->
        <div
          v-for="sectionId in visitedSectionIds"
          :key="sectionId"
          class="settings-navigation__page"
          :hidden="sectionId !== displayedSectionId"
          :inert="sectionId !== selectedSectionId ? true : undefined"
        >
          <slot :name="sectionId" />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-navigation {
  container: am-settings / inline-size;
  block-size: 100%;
  min-block-size: 0;
  overflow: hidden;
}
.settings-navigation__stage {
  display: grid;
  grid-template-columns: minmax(200px, 0.33fr) minmax(0, 1fr);
  block-size: 100%;
  min-block-size: 0;
}
.settings-navigation__overview,
.settings-navigation__detail {
  min-inline-size: 0;
  min-block-size: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.settings-navigation__overview {
  padding: var(--am-space-5) var(--am-space-4);
  border-inline-end: 1px solid var(--am-color-border);
  background: var(--am-color-background);
}
.settings-navigation__group + .settings-navigation__group {
  margin-block-start: var(--am-space-5);
}
.settings-navigation__group h3 {
  margin: 0 0 var(--am-space-2);
  padding-inline: var(--am-space-3);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-weight: 600;
}
.settings-navigation__entries {
  display: grid;
  gap: var(--am-space-1);
}
.settings-navigation__entry {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-block-size: 64px;
  align-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-3);
  border: 0;
  border-radius: var(--am-radius-sm);
  background: transparent;
  color: var(--am-color-text);
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.settings-navigation__entry:hover {
  background: var(--am-color-hover);
}
.settings-navigation__entry[aria-current='page'] {
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}
.settings-navigation__icon {
  display: grid;
  place-items: center;
  color: var(--am-color-primary);
}
.settings-navigation__entry-copy {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-1);
}
.settings-navigation__entry-copy strong {
  font-size: var(--am-font-size-sm);
  font-weight: 600;
}
.settings-navigation__entry-copy small {
  overflow: hidden;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-navigation__chevron {
  color: var(--am-color-text-secondary);
}
.settings-navigation__detail {
  padding: var(--am-space-6) var(--am-space-7);
  background: var(--am-color-surface);
}
.settings-navigation__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: var(--am-space-3);
  margin-block-end: var(--am-space-6);
}
.settings-navigation__header h3,
.settings-navigation__header p {
  margin: 0;
}
.settings-navigation__header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--am-space-3);
}
.settings-navigation__header h3 {
  min-inline-size: 0;
  overflow-wrap: anywhere;
  font-size: var(--am-font-size-lg);
  letter-spacing: -0.025em;
}
.settings-navigation__header p {
  grid-column: 1 / -1;
  margin-block-start: var(--am-space-1);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
.settings-navigation__page[hidden] {
  display: none;
}
.settings-navigation__back {
  display: inline-flex;
  min-block-size: 44px;
  align-items: center;
  justify-self: end;
  gap: var(--am-space-1);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--am-color-primary);
  font: inherit;
  cursor: pointer;
}
.settings-navigation__entry:focus-visible,
.settings-navigation__back:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
/* 两页位移保持手机设置的空间关系；布局模式由壳层决定，局部宽度只压缩留白。 */
.settings-navigation--mobile .settings-navigation__stage {
  grid-template-columns: 100% 100%;
  transition: transform var(--am-motion-normal) var(--am-ease-standard);
}
.settings-navigation--mobile[data-detail-open='true'] .settings-navigation__stage {
  transform: translateX(-100%);
}
.settings-navigation--mobile .settings-navigation__overview {
  padding: var(--am-space-4);
  border: 0;
}
.settings-navigation--mobile .settings-navigation__entries {
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface);
}
.settings-navigation--mobile .settings-navigation__entry {
  min-block-size: 72px;
  border-radius: 0;
  padding: var(--am-space-3) var(--am-space-4);
}
.settings-navigation--mobile .settings-navigation__entry + .settings-navigation__entry {
  border-block-start: 1px solid var(--am-color-border);
}
.settings-navigation--mobile .settings-navigation__detail {
  padding: var(--am-space-4);
  padding-block-end: max(var(--am-space-6), env(safe-area-inset-bottom));
}
@container am-settings (max-width: 680px) {
  .settings-navigation__detail {
    padding-inline: var(--am-space-4);
  }
}
@media (prefers-reduced-motion: reduce) {
  .settings-navigation--mobile .settings-navigation__stage {
    transition: none;
  }
}
</style>
