<script setup lang="ts">
import {
  type GlobalSettingsEmits,
  type GlobalSettingsProps,
  type GlobalSettingsSlots,
  useGlobalSettings,
} from '@any-music/ui'
import type { SettingsGroup } from '@any-music/ui'
import SettingsNumberForm from '@any-music/ui/components/settings/SettingsNumberForm.vue'
import { computed, useSlots } from 'vue'

import CatalogFilterHistorySettings from './CatalogFilterHistorySettings.vue'
import CollectionDisplaySettings from './CollectionDisplaySettings.vue'
import CreatorProfileSettingsForm from './CreatorProfileSettingsForm.vue'
import MusicSourceSettings from './MusicSourceSettings.vue'
import SettingsNavigation from './SettingsNavigation.vue'

const props = defineProps<GlobalSettingsProps>()
const emit = defineEmits<GlobalSettingsEmits>()

defineSlots<GlobalSettingsSlots>()

const slots = useSlots()
// 分类只提供信息架构，运行端外观/网络能力仍通过命名插槽注入。
const settingsGroups = computed<readonly SettingsGroup[]>(() => [
  ...(slots['appearance-settings'] || slots['navigation-settings'] || props.setDisplayDefault
    ? [
        {
          id: 'interface',
          title: '外观与导航',
          entries: [
            ...(slots['appearance-settings']
              ? [
                  {
                    id: 'appearance' as const,
                    title: '外观与布局',
                    icon: 'palette' as const,
                    description: '选择喜欢的主题和适合自己的布局。',
                    summary: props.appearanceSummary ?? '主题 · 侧栏 · 底部导航',
                  },
                ]
              : []),
            ...(slots['navigation-settings']
              ? [
                  {
                    id: 'navigation' as const,
                    title: '导航管理',
                    icon: 'list' as const,
                    description: '调整功能入口的顺序与可见性。',
                    summary: '排序与显示',
                  },
                ]
              : []),
            ...(props.setDisplayDefault
              ? [
                  {
                    id: 'display' as const,
                    title: '展示方式',
                    icon: 'layout' as const,
                    description:
                      '按板块设置各区域的默认风格与排列方式，选择后立即保存；已单独调整的区域保留各自设置。',
                    summary: '默认风格 · 排列方式',
                  },
                ]
              : []),
          ],
        },
      ]
    : []),
  {
    id: 'music',
    title: '音乐源',
    entries: [
      {
        id: 'sources',
        title: '音乐源管理',
        icon: 'music',
        description: '至少保留一个音乐源。关闭音乐源不会删除已有歌曲和列表。',
        summary: `已启用 ${props.enabledPluginIds.length} 个音乐源`,
      },
      ...(props.externalSourcesEnabled && slots['external-source-settings']
        ? [
            {
              id: 'external-sources' as const,
              title: '外置音乐源',
              icon: 'link' as const,
              description:
                '通过接口地址或本地文件导入标准 .amplugin 插件包，校验后确认安装与授权。',
              summary: '接口导入 · 文件导入',
            },
          ]
        : []),
      ...(slots['account-settings']
        ? [
            {
              id: 'accounts' as const,
              title: '账号管理',
              icon: 'user' as const,
              description: '管理各平台账号、登录状态和账号使用方式。',
              summary: props.accountSummary ?? '账号与登录',
            },
          ]
        : []),
    ],
  },
  {
    id: 'network',
    title: '网络与下载',
    entries: [
      ...(slots['cache-settings']
        ? [
            {
              id: 'cache' as const,
              title: '资源缓存',
              icon: 'download' as const,
              description: '管理图片、封面和歌曲片段的缓存容量与位置。',
              summary: '容量 · 位置 · 清理',
            },
          ]
        : []),
      ...(slots['network-settings']
        ? [
            {
              id: 'proxy' as const,
              title: props.networkTitle ?? '请求代理',
              icon: 'link' as const,
              description: props.networkDescription ?? '保存代理配置，按需启用或关闭。',
              summary: props.networkSummary ?? '连接偏好',
            },
          ]
        : []),
      {
        id: 'downloads',
        title: '歌曲下载',
        icon: 'download',
        description: slots['download-settings']
          ? '选择下载保存目录，调整下载并发。'
          : '根据网络与设备性能调整下载并发。',
        summary: `最多 ${props.downloadConcurrency} 首同时下载`,
      },
    ],
  },
  {
    id: 'data',
    title: '记录与创作',
    entries: [
      {
        id: 'playback-history',
        title: '播放历史',
        icon: 'history',
        description: '设置播放记录的保留数量。',
        summary: `最多保留 ${props.historyLimit} 条`,
      },
      {
        id: 'filter-history',
        title: '筛选历史',
        icon: 'filter',
        description: '按板块和筛选区域分别设置历史保留与展示。',
        summary: '音乐列表 · 列表内歌曲',
      },
      {
        id: 'creator-profile',
        title: '创作者资料',
        icon: 'user',
        description: '设置自定义拼接作品使用的创作者名称。',
        summary: props.profile.displayName,
      },
    ],
  },
])

const {
  downloadConcurrencyInput,
  downloadError,
  historyLimitInput,
  historyError,
  maxDownloadConcurrency,
  maxPlaybackHistoryLimit,
  minDownloadConcurrency,
  minPlaybackHistoryLimit,
  pluginGroups,
  profileName,
  profileError,
  setPluginEnabled,
  checkPlugin,
  submitDownloadConcurrency,
  submitHistoryLimit,
  submitProfile,
} = useGlobalSettings({ emit, props })
</script>

<template>
  <!-- 模态关闭/焦点圈由外层负责，此处只组合设置分类与受控表单。 -->
  <SettingsNavigation
    :groups="settingsGroups"
    :is-mobile-layout="props.isMobileLayout ?? false"
    :initial-section="props.initialSection"
    @select-section="emit('selectSection', $event)"
  >
    <template #header-actions="{ section }">
      <slot
        v-if="section === 'cache'"
        name="cache-settings"
        placement="header"
        :is-mobile-layout="props.isMobileLayout ?? false"
        :overlay-target="props.overlayTarget"
        :suspended="props.suspended"
        :detail-open-change="(open: boolean) => emit('detailOpenChange', open)"
      />
    </template>
    <template #appearance><slot name="appearance-settings" /></template>
    <template #navigation><slot name="navigation-settings" /></template>
    <template #display>
      <CollectionDisplaySettings
        :settings="props.displayDefaults"
        :set-default="props.setDisplayDefault"
        :overlay-target="props.overlayTarget"
        :suspended="props.suspended"
        @detail-open-change="emit('detailOpenChange', $event)"
      />
    </template>
    <template #sources>
      <MusicSourceSettings
        :groups="pluginGroups"
        :enabled-plugin-ids="props.enabledPluginIds"
        :availability-by-plugin-id="props.availabilityByPluginId"
        @set-plugin-enabled="setPluginEnabled"
        @check-plugin="checkPlugin"
      />
    </template>
    <template #external-sources>
      <slot v-if="props.externalSourcesEnabled" name="external-source-settings" />
    </template>
    <template #proxy><slot name="network-settings" /></template>
    <template #cache
      ><slot
        name="cache-settings"
        placement="content"
        :is-mobile-layout="props.isMobileLayout ?? false"
        :overlay-target="props.overlayTarget"
        :suspended="props.suspended"
        :detail-open-change="(open: boolean) => emit('detailOpenChange', open)"
    /></template>
    <template #accounts
      ><slot
        name="account-settings"
        :is-mobile-layout="props.isMobileLayout ?? false"
        :overlay-target="props.overlayTarget"
        :suspended="props.suspended"
        :detail-open-change="(open: boolean) => emit('detailOpenChange', open)"
    /></template>
    <template #downloads>
      <div class="settings-sections">
        <slot name="download-settings" />
        <SettingsNumberForm
          v-model="downloadConcurrencyInput"
          label="最高下载并发"
          focus-key="settings:downloads:concurrency"
          :description="`同时下载越多，占用的网络、内存与编码资源越多。最多允许 ${maxDownloadConcurrency} 首并发；单首失败后自动重试 3 次。`"
          :minimum="minDownloadConcurrency"
          :maximum="maxDownloadConcurrency"
          save-label="保存下载设置"
          :error-message="downloadError"
          @save="submitDownloadConcurrency"
        />
      </div>
    </template>
    <template #playback-history>
      <SettingsNumberForm
        v-model="historyLimitInput"
        label="最大记录数量"
        focus-key="settings:playback-history:limit"
        :description="`调小后立即移除超出上限的最旧记录，最多保留 ${maxPlaybackHistoryLimit} 条。`"
        :minimum="minPlaybackHistoryLimit"
        :maximum="maxPlaybackHistoryLimit"
        save-label="保存历史设置"
        :error-message="historyError"
        @save="submitHistoryLimit"
      />
    </template>
    <template #filter-history>
      <CatalogFilterHistorySettings
        :is-mobile-layout="props.isMobileLayout"
        :settings="props.filterHistorySettings"
        :set-settings="props.setFilterHistorySettings"
        :overlay-target="props.overlayTarget"
        :suspended="props.suspended"
        @detail-open-change="emit('detailOpenChange', $event)"
      />
    </template>
    <template #creator-profile>
      <CreatorProfileSettingsForm
        v-model="profileName"
        :user-id="props.profile.id"
        :error-message="profileError"
        @save="submitProfile"
      />
    </template>
  </SettingsNavigation>
</template>
