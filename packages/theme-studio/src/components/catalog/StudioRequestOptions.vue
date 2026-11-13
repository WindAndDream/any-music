<script setup lang="ts">
import { editingStateKey, useEditingSession } from '@any-music/ui/catalog'
import type { CatalogDrawerView } from '@any-music/ui/catalog'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { shallowRef } from 'vue'
import type { DeepReadonly, ShallowRef } from 'vue'

import { useStudioActivity } from '../../composables/use-studio-activity'
const props = defineProps<{
  feature: UiThemeFeatureMap['catalog']
  drawer: DeepReadonly<CatalogDrawerView>
  index: number
}>()
const draft = useEditingSession(`catalog:request:${props.drawer.id}`).state(titleKey, () =>
  shallowRef(props.drawer.title),
)
const { confirmAction } = useStudioActivity(() => props.feature.availability)
function move(offset: -1 | 1) {
  const ids = props.feature.state.drawers.map((item) => item.id),
    target = ids[props.index + offset]
  if (target) props.feature.actions.moveDrawer(props.drawer.id, target, ids)
}
function remove() {
  const id = props.drawer.id
  void confirmAction(
    '删除音乐列表',
    '删除列表不会删除喜欢、歌单或下载记录。',
    () => props.feature.actions.removeDrawer(id),
    () => props.feature.state.drawers.some((item) => item.id === id),
  )
}
</script>
<script lang="ts">
const titleKey = editingStateKey<ShallowRef<string>>('studio-request-title')
</script>
<template>
  <details>
    <summary>列表详情与操作</summary>
    <dl>
      <dt>原始请求</dt>
      <dd>{{ drawer.input }}</dd>
      <dt>状态</dt>
      <dd>{{ drawer.status }} · {{ drawer.loadedPageCount }} 页 · {{ drawer.tracks.length }} 首</dd>
    </dl>
    <fieldset :disabled="feature.availability.status !== 'available'">
      <form @submit.prevent="draft.trim() && feature.actions.renameDrawer(drawer.id, draft.trim())">
        <label>列表名称<input v-model="draft" maxlength="80" /></label
        ><button type="submit" :disabled="!draft.trim()">保存列表名称</button>
      </form>
      <div class="studio-actions">
        <button type="button" @click="feature.actions.restoreDrawerNames([drawer.id])">
          恢复列表原名</button
        ><button
          type="button"
          :disabled="index === 0"
          :aria-label="`上移列表 ${drawer.title}`"
          @click="move(-1)"
        >
          上移</button
        ><button
          type="button"
          :disabled="index === feature.state.drawers.length - 1"
          :aria-label="`下移列表 ${drawer.title}`"
          @click="move(1)"
        >
          下移</button
        ><button type="button" @click="remove">删除音乐列表</button>
      </div>
    </fieldset>
  </details>
</template>
