<script setup lang="ts">
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed } from 'vue'

const props = defineProps<{ feature: UiThemeFeatureMap['catalog'] }>()
const source = computed(() =>
  props.feature.state.sources.find((entry) => entry.id === props.feature.state.sourceId),
)
const enabled = computed(
  () => props.feature.availability.status === 'available' && Boolean(source.value?.enabled),
)
const canSubmit = computed(
  () =>
    enabled.value &&
    (props.feature.state.requestKind === 'search'
      ? source.value?.capabilities.search && Boolean(props.feature.state.searchQuery.trim())
      : source.value?.capabilities.importUrl && Boolean(props.feature.state.importUrl.trim())),
)
function submit(): void {
  if (canSubmit.value) void props.feature.actions.submit()
}
</script>

<template>
  <form class="studio-search" aria-label="搜索或导入音乐" @submit.prevent="submit">
    <p v-if="!source || !source.enabled" role="status">
      {{ source ? '当前音乐源已停用。' : '暂无可用音乐源。'
      }}<button type="button" @click="feature.actions.openSourceSettings">打开音乐源设置</button>
    </p>
    <label class="studio-field"
      >音乐源<select
        aria-label="音乐源"
        :value="feature.state.sourceId"
        :disabled="feature.availability.status !== 'available' || !feature.state.sources.length"
        data-am-focus-key="catalog:source"
        @change="feature.actions.selectSource(($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="item in feature.state.sources"
          :key="item.id"
          :value="item.id"
          :disabled="!item.enabled"
        >
          {{ item.name }}{{ item.enabled ? '' : '（已停用）' }}
        </option>
      </select></label
    >
    <div class="studio-request-kinds" role="group" aria-label="请求方式">
      <button
        type="button"
        :aria-pressed="feature.state.requestKind === 'search'"
        :disabled="!enabled || !source?.capabilities.search"
        @click="feature.actions.setRequestKind('search')"
      >
        搜索音乐
      </button>
      <button
        type="button"
        :aria-pressed="feature.state.requestKind === 'import-url'"
        :disabled="!enabled || !source?.capabilities.importUrl"
        @click="feature.actions.setRequestKind('import-url')"
      >
        导入链接
      </button>
    </div>
    <label v-if="feature.state.requestKind === 'search'" class="studio-field"
      >搜索关键词<input
        type="search"
        aria-label="搜索关键词"
        :value="feature.state.searchQuery"
        :disabled="!enabled || !source?.capabilities.search"
        data-am-focus-key="catalog:search"
        @input="feature.actions.setSearchQuery(($event.target as HTMLInputElement).value)"
    /></label>
    <label v-else class="studio-field"
      >导入链接<input
        type="url"
        aria-label="导入链接"
        :value="feature.state.importUrl"
        :disabled="!enabled || !source?.capabilities.importUrl"
        data-am-focus-key="catalog:import"
        @input="feature.actions.setImportUrl(($event.target as HTMLInputElement).value)"
      /><small
        v-for="scope in source?.importUrlScopes"
        :key="`${scope.origin}${scope.pathnamePrefix}`"
        >{{ scope.origin }}{{ scope.pathnamePrefix }}</small
      ></label
    >
    <button type="submit" :disabled="!canSubmit">
      {{ feature.state.requestKind === 'search' ? '开始搜索' : '开始导入' }}
    </button>
    <button type="button" @click="feature.actions.clear">清空输入</button>
  </form>
</template>
