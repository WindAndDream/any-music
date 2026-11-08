<script setup lang="ts">
import type { SettingsSectionId } from '@any-music/ui'
import SettingsNumberForm from '@any-music/ui/components/settings/SettingsNumberForm.vue'
import type { UiThemeFeatureMap, UiThemeHostSlots } from '@any-music/ui/theme'
import { computed, shallowRef, useId, useSlots } from 'vue'

import { useStudioSettings } from '../../composables/use-studio-settings'
import StudioFeatureStatus from '../StudioFeatureStatus.vue'
import StudioAppearance from './StudioAppearance.vue'
import StudioDisplaySettings from './StudioDisplaySettings.vue'
import StudioFilterHistory from './StudioFilterHistory.vue'
const props = defineProps<{ feature: UiThemeFeatureMap['settings'] }>()
defineSlots<UiThemeHostSlots>()
const slots = useSlots()
const emit = defineEmits<{ detailOpenChange: [open: boolean] }>()
const overlayTarget = shallowRef<HTMLElement | null>(null)
const {
  state,
  profileName,
  profileError,
  historyLimitInput,
  historyError,
  downloadConcurrencyInput,
  downloadError,
  minDownloadConcurrency,
  maxDownloadConcurrency,
  minPlaybackHistoryLimit,
  maxPlaybackHistoryLimit,
  submitProfile,
  submitHistoryLimit,
  submitDownloadConcurrency,
  setPluginEnabled,
  checkPlugin,
} = useStudioSettings(props)
const lastSourceDescriptionId = `${useId()}-last-source`
const hasSingleEnabledSource = computed(() => state.value.enabledSourceIds.length === 1)
function isLastEnabledSource(id: string): boolean {
  return hasSingleEnabledSource.value && state.value.enabledSourceIds.includes(id)
}
function changeSource(id: string, event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.checked || !isLastEnabledSource(id)) setPluginEnabled(id, input.checked)
  // Native controls toggle before the host can reject an intent without changing its projection.
  input.checked = state.value.enabledSourceIds.includes(id)
}
const sections = computed(
  () =>
    [
      { id: 'appearance', title: '外观与布局' },
      { id: 'navigation', title: '导航管理' },
      ...(props.feature.actions.setDisplayDefault ? [{ id: 'display', title: '展示方式' }] : []),
      { id: 'sources', title: '音乐源管理' },
      ...(slots['account-settings'] ? [{ id: 'accounts', title: '账号管理' }] : []),
      ...(slots['network-settings']
        ? [{ id: 'proxy', title: state.value.networkTitle ?? '请求代理' }]
        : []),
      ...(state.value.externalSourcesEnabled && slots['external-source-settings']
        ? [{ id: 'external-sources', title: '外置音乐源' }]
        : []),
      { id: 'downloads', title: '歌曲下载' },
      ...(slots['cache-settings'] ? [{ id: 'cache', title: '资源缓存' }] : []),
      { id: 'playback-history', title: '播放历史' },
      { id: 'filter-history', title: '筛选历史' },
      { id: 'creator-profile', title: '创作者资料' },
    ] as readonly { id: SettingsSectionId; title: string }[],
)
</script>
<template>
  <section class="studio-settings" aria-label="全局设置">
    <StudioFeatureStatus :availability="feature.availability" :status="feature.status" />
    <div class="studio-split">
      <nav aria-label="设置分类">
        <button
          v-for="section in sections"
          :key="section.id"
          type="button"
          :aria-current="state.section === section.id ? 'page' : undefined"
          :disabled="state.suspended || feature.availability.status !== 'available'"
          :data-am-focus-key="`settings:section:${section.id}`"
          @click="feature.actions.selectSection(section.id)"
        >
          {{ section.title }}
        </button>
      </nav>
      <fieldset
        :disabled="state.suspended || feature.availability.status !== 'available'"
        :inert="state.suspended ? true : undefined"
      >
        <header class="studio-settings__header">
          <h2>{{ sections.find((section) => section.id === state.section)?.title ?? '设置' }}</h2>
          <slot
            v-if="state.section === 'cache'"
            name="cache-settings"
            placement="header"
            :is-mobile-layout="state.isMobileLayout"
            :overlay-target="overlayTarget"
            :suspended="state.suspended"
            :detail-open-change="(open: boolean) => emit('detailOpenChange', open)"
          />
        </header>
        <p v-if="!state.section">选择要调整的设置。</p>
        <StudioAppearance
          v-else-if="state.section === 'appearance' || state.section === 'navigation'"
          :feature="feature"
        />
        <div v-else-if="state.section === 'sources'">
          <p v-if="!state.sources.length">暂无可用音乐源。</p>
          <p v-if="hasSingleEnabledSource" :id="lastSourceDescriptionId" role="status">
            至少需要保留一个已启用的音乐源。
          </p>
          <article v-for="source in state.sources" :key="source.id">
            <label class="studio-selection"
              ><input
                type="checkbox"
                :checked="state.enabledSourceIds.includes(source.id)"
                :disabled="isLastEnabledSource(source.id)"
                :aria-describedby="
                  isLastEnabledSource(source.id) ? lastSourceDescriptionId : undefined
                "
                @change="changeSource(source.id, $event)"
              />{{ source.name }}</label
            >
            <p>{{ state.availabilityBySourceId[source.id]?.status ?? '尚未检测' }}</p>
            <button type="button" @click="checkPlugin(source.id)">检测音乐源</button>
          </article>
        </div>
        <template v-else-if="state.section === 'creator-profile'"
          ><form novalidate @submit.prevent="submitProfile">
            <label class="studio-field"
              >显示名称<input
                v-model="profileName"
                data-am-focus-key="settings:creator-profile:name"
                maxlength="80"
                :aria-invalid="Boolean(profileError)" /></label
            ><label class="studio-field"
              >稳定用户 ID<input :value="state.profileId" readonly
            /></label>
            <p v-if="profileError" role="alert">{{ profileError }}</p>
            <button type="submit">保存创作者名称</button>
          </form></template
        >
        <SettingsNumberForm
          v-else-if="state.section === 'playback-history'"
          v-model="historyLimitInput"
          label="历史记录数量"
          description="调整播放记录保留数量。"
          :minimum="minPlaybackHistoryLimit"
          :maximum="maxPlaybackHistoryLimit"
          :error-message="historyError"
          focus-key="settings:playback-history:limit"
          save-label="保存历史数量"
          @save="submitHistoryLimit"
        />
        <template v-else-if="state.section === 'downloads'"
          ><SettingsNumberForm
            v-model="downloadConcurrencyInput"
            label="下载并发"
            description="调整同时进行的下载数量。"
            :minimum="minDownloadConcurrency"
            :maximum="maxDownloadConcurrency"
            :error-message="downloadError"
            focus-key="settings:downloads:concurrency"
            save-label="保存下载并发"
            @save="submitDownloadConcurrency" /><slot name="download-settings"
        /></template>
        <StudioFilterHistory v-else-if="state.section === 'filter-history'" :feature="feature" />
        <StudioDisplaySettings
          v-else-if="state.section === 'display'"
          :feature="feature"
          :overlay-target="overlayTarget"
          @detail-open-change="emit('detailOpenChange', $event)"
        />
        <slot
          v-else-if="state.section === 'accounts'"
          name="account-settings"
          :is-mobile-layout="state.isMobileLayout"
          :overlay-target="overlayTarget"
          :suspended="state.suspended"
          :detail-open-change="(open: boolean) => emit('detailOpenChange', open)"
        />
        <slot v-else-if="state.section === 'proxy'" name="network-settings" />
        <slot
          v-else-if="state.section === 'cache'"
          name="cache-settings"
          placement="content"
          :is-mobile-layout="state.isMobileLayout"
          :overlay-target="overlayTarget"
          :suspended="state.suspended"
          :detail-open-change="(open: boolean) => emit('detailOpenChange', open)"
        />
        <slot v-else-if="state.section === 'external-sources'" name="external-source-settings" />
        <p v-else role="status">此设置在当前运行端不可用。</p>
      </fieldset>
    </div>
    <div ref="overlayTarget" class="studio-settings-overlays"></div>
  </section>
</template>

<style scoped>
.studio-settings__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-3);
  margin-block-end: var(--am-space-4);
}
.studio-settings__header h2 {
  margin: 0;
}
</style>
