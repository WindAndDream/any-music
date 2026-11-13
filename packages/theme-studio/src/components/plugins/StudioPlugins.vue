<script setup lang="ts">
import { usePluginCenterView } from '@any-music/ui'
import type { PluginCenterDisplay } from '@any-music/ui'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import PluginDisplayOptions from '@any-music/ui/components/plugins/PluginDisplayOptions.vue'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { shallowRef } from 'vue'

import StudioPageOverlays from '../overlays/StudioPageOverlays.vue'
import StudioFeatureStatus from '../StudioFeatureStatus.vue'
import StudioPluginCard from './StudioPluginCard.vue'

const props = defineProps<{ feature: UiThemeFeatureMap['plugins'] }>()
const { filter, display, counts, visible } = usePluginCenterView(
  () => props.feature.state.items,
  () => props.feature.state.defaultDisplay,
)
const displayOpen = shallowRef(false)
function selectDisplay(value: PluginCenterDisplay): void {
  display.value = value
  displayOpen.value = false
}
const filters = [
  { id: 'all', label: '全部' },
  { id: 'builtin', label: '内置' },
  { id: 'external', label: '外置' },
] as const
</script>

<template>
  <section class="studio-library studio-plugins" aria-label="插件中心">
    <header class="studio-plugins__heading">
      <div>
        <h1>插件中心</h1>
        <p>
          内置 <strong>{{ counts.builtin }}</strong
          ><span
            >外置 <strong>{{ counts.external }}</strong></span
          >
        </p>
      </div>
      <div class="studio-plugins__tools">
        <button
          type="button"
          aria-label="选择插件展示方式"
          aria-haspopup="dialog"
          @click="displayOpen = true"
        >
          <AppIcon name="list" :size="16" />展示方式
        </button>
        <button
          class="studio-plugins__import"
          type="button"
          aria-haspopup="dialog"
          :disabled="
            !feature.state.externalSupported || feature.availability.status !== 'available'
          "
          :title="
            feature.state.externalSupported ? '导入插件包并确认安装' : '当前运行端不支持外置插件'
          "
          @click="feature.actions.importPlugin()"
        >
          <AppIcon name="import" :size="16" />导入
        </button>
      </div>
    </header>
    <StudioFeatureStatus :availability="feature.availability" :status="feature.status" />
    <div class="studio-plugins__filters" role="group" aria-label="插件分类">
      <button
        v-for="option in filters"
        :key="option.id"
        type="button"
        :aria-pressed="filter === option.id"
        @click="filter = option.id"
      >
        {{ option.label }} <span>{{ counts[option.id] }}</span>
      </button>
    </div>
    <p v-if="feature.state.errorMessage" role="alert">
      {{ feature.state.errorMessage
      }}<button type="button" :disabled="feature.state.busy" @click="feature.actions.refresh()">
        重新读取
      </button>
    </p>
    <p v-if="feature.state.busy" role="status">正在更新外置插件…</p>
    <p v-if="filter === 'external' && !feature.state.externalSupported" role="status">
      当前运行端不支持外置插件，可使用内置插件。
    </p>
    <fieldset
      class="studio-plugins__fields"
      :disabled="feature.availability.status !== 'available'"
    >
      <legend class="am-sr-only">插件列表</legend>
      <div v-if="visible.length" class="studio-plugins__items" :data-display="display">
        <StudioPluginCard
          v-for="item in visible"
          :key="item.id"
          :item="item"
          :busy="feature.state.busy"
          @set-enabled="
            feature.availability.status === 'available' &&
            feature.actions.setEnabled(item.id, $event)
          "
          @retry="feature.actions.retry(item.id)"
          @manage="feature.actions.manageExternal(item.id)"
        />
      </div>
      <div v-else class="studio-plugins__empty" role="status">
        <AppIcon name="plugin" :size="32" /><strong>{{
          filter === 'external' ? '还没有外置插件' : '暂无可用插件'
        }}</strong>
        <p>
          {{
            filter === 'external' && feature.state.externalSupported
              ? '从右上角导入插件包，确认安装后即可在这里管理。'
              : '可切换分类查看其他插件。'
          }}
        </p>
      </div>
    </fieldset>
    <StudioPageOverlays :open="displayOpen">
      <AppDialog
        :open="displayOpen"
        title="插件展示方式"
        size="compact"
        @close="displayOpen = false"
        ><PluginDisplayOptions :display="display" @select="selectDisplay"
      /></AppDialog>
    </StudioPageOverlays>
  </section>
</template>
