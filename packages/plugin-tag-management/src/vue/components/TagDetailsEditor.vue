<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { TagManagementPresentation } from '@any-music/ui/theme'
import { computed } from 'vue'

const props = defineProps<{ editor: TagManagementPresentation }>()
const state = computed(() => props.editor.state)
function updateName(event: Event): void {
  props.editor.actions.setTagNameDraft((event.target as HTMLInputElement).value)
}
</script>

<template>
  <form
    v-if="state.detailTag"
    class="tag-details__rename"
    @submit.prevent="editor.actions.renameTag(state.detailTag.name, state.tagNameDraft)"
  >
    <label class="tag-maintenance__field"
      >标签名称
      <input
        class="tag-maintenance__input"
        name="tag-detail-name"
        :value="state.tagNameDraft"
        maxlength="32"
        aria-label="标签的新名称"
        autocomplete="off"
        @input="updateName"
      />
    </label>
    <p class="tag-maintenance__hint">
      重命名、合并或删除会同步到全部关联歌曲和歌单；删除标签不会删除歌曲或歌单。
    </p>
    <div class="tag-details__actions">
      <div class="tag-details__primary-actions">
        <button type="button" @click="editor.actions.setDetailView('actions')">
          <AppIcon name="arrow-left" :size="18" />返回
        </button>
        <button
          class="tag-details__save"
          type="submit"
          :disabled="
            !state.tagNameDraft.trim() ||
            state.tagNameDraft === state.detailTag.name ||
            state.confirming
          "
        >
          保存名称
        </button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.tag-details__rename {
  margin-block-start: var(--am-space-2);
}
.tag-details__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--am-space-2);
  padding-block-start: var(--am-space-3);
  border-block-start: 1px solid var(--am-color-border);
}
.tag-details__primary-actions {
  display: flex;
  flex: none;
  order: 1;
  justify-content: flex-end;
  gap: var(--am-space-2);
}
.tag-details__actions button {
  display: inline-flex;
  flex: none;
  min-block-size: 44px;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-3);
  font-weight: 400;
  white-space: nowrap;
}
.tag-details__actions .tag-details__save {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
.tag-details__actions .tag-details__save:not(:disabled):hover {
  background: var(--am-color-primary-hover);
}
.tag-details__rename :is(button, input):focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
</style>
