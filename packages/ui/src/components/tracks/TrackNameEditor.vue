<script setup lang="ts">
import { MAX_TRACK_CUSTOM_NAME_LENGTH, normalizeTrackCustomName } from '@any-music/core'
import { computed, shallowRef } from 'vue'

import { trackNameDraftKey } from '../../composables/tracks/track-action-editing-state'
import { useEditingSession } from '../../composables/use-editing-session'
import NameEditor from '../NameEditor.vue'

/** 名称草稿只服务当前编辑视图；保存与返回分别交回宿主处理，返回不提交草稿。 */
const props = defineProps<{ originalName: string; customName?: string }>()
const emit = defineEmits<{ save: [name: string]; back: [] }>()
const nameDraft = useEditingSession('name-editor').state(trackNameDraftKey, () =>
  shallowRef(props.customName ?? ''),
)
const validation = computed(() => {
  try {
    return { name: normalizeTrackCustomName(nameDraft.value), error: '' }
  } catch {
    return { name: undefined, error: `名称不能超过 ${MAX_TRACK_CUSTOM_NAME_LENGTH} 个字符。` }
  }
})
const canSave = computed(
  () => !validation.value.error && validation.value.name !== props.customName,
)
function save(): void {
  if (canSave.value) emit('save', validation.value.name ?? '')
}
</script>

<template>
  <NameEditor
    v-model="nameDraft"
    :original-name="props.originalName"
    original-label="来源原名"
    input-name="track-custom-name"
    placeholder="输入你喜欢的歌曲名称"
    help-text="最多 80 个字符；留空可恢复原名，列表和播放器会同步更新。"
    :max-length="MAX_TRACK_CUSTOM_NAME_LENGTH"
    :can-save="canSave"
    :error="validation.error"
    @save="save"
    @back="emit('back')"
  />
</template>
