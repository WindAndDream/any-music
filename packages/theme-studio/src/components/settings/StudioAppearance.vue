<script setup lang="ts">
import type { AppShellPreferences, ProductViewId } from '@any-music/ui'
import { useEditingSession } from '@any-music/ui'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, onScopeDispose } from 'vue'
const props = defineProps<{ feature: UiThemeFeatureMap['settings'] }>()
const state = computed(() => props.feature.state)
const session = useEditingSession('settings')
let active = true
onScopeDispose(() => {
  active = false
})
const available = () =>
  active &&
  session.active &&
  state.value.open &&
  !state.value.suspended &&
  props.feature.availability.status === 'available'
function update(value: Partial<AppShellPreferences>) {
  if (available()) props.feature.actions.setPreferences({ ...state.value.preferences, ...value })
}
function appearance(value: string) {
  if (available() && (value === 'system' || value === 'light' || value === 'dark'))
    props.feature.actions.setAppearance(value)
}
function theme(event: Event) {
  const select = event.target as HTMLSelectElement
  const choice = state.value.themes.find((item) => item.id === select.value)
  if (available() && choice) void props.feature.actions.selectTheme(choice.id)
  select.value = state.value.themeId
}
function visible(id: ProductViewId, enabled: boolean) {
  if (!state.value.destinations.some((item) => item.id === id && item.canHide)) return
  const hidden = state.value.preferences.hiddenDestinationIds.filter((value) => value !== id)
  update({ hiddenDestinationIds: enabled ? hidden : [...hidden, id] })
}
function move(id: ProductViewId, offset: -1 | 1) {
  const ids = [...state.value.preferences.destinationOrder],
    index = ids.indexOf(id),
    next = index + offset
  if (index < 0 || next < 0 || next >= ids.length) return
  ;[ids[index], ids[next]] = [ids[next]!, ids[index]!]
  update({ destinationOrder: ids })
}
</script>
<template>
  <div v-if="state.section === 'appearance'" class="studio-settings-grid">
    <label class="studio-field"
      >外观模式<select
        :value="state.appearance"
        @change="appearance(($event.target as HTMLSelectElement).value)"
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色主题</option>
        <option value="dark">深色主题</option>
      </select></label
    >
    <label class="studio-field"
      >界面主题<select :value="state.themeId" @change="theme">
        <option v-for="choice in state.themes" :key="choice.id" :value="choice.id">
          {{ choice.title }}
        </option>
      </select></label
    >
    <p v-if="state.themeError" role="alert">{{ state.themeError }}</p>
    <label class="studio-field"
      >导航侧边<select
        :value="state.preferences.sidebarSide"
        @change="
          update({
            sidebarSide: ($event.target as HTMLSelectElement).value === 'right' ? 'right' : 'left',
          })
        "
      >
        <option value="left">左侧</option>
        <option value="right">右侧</option>
      </select></label
    >
    <label
      ><input
        type="checkbox"
        :checked="state.preferences.isMobileNavigationEnabled"
        @change="update({ isMobileNavigationEnabled: ($event.target as HTMLInputElement).checked })"
      />启用手机底部导航</label
    >
  </div>
  <ol v-else class="studio-request-list">
    <li v-for="(id, index) in state.preferences.destinationOrder" :key="id">
      <label
        ><input
          type="checkbox"
          :checked="!state.preferences.hiddenDestinationIds.includes(id)"
          :disabled="!state.destinations.find((item) => item.id === id)?.canHide"
          @change="visible(id, ($event.target as HTMLInputElement).checked)"
        />{{ state.destinations.find((item) => item.id === id)?.label ?? id
        }}<span v-if="!state.destinations.find((item) => item.id === id)?.canHide"
          >（必需）</span
        ></label
      ><button
        type="button"
        :aria-label="`上移导航 ${id}`"
        :disabled="index === 0"
        @click="move(id, -1)"
      >
        上移</button
      ><button
        type="button"
        :aria-label="`下移导航 ${id}`"
        :disabled="index === state.preferences.destinationOrder.length - 1"
        @click="move(id, 1)"
      >
        下移
      </button>
    </li>
  </ol>
</template>
