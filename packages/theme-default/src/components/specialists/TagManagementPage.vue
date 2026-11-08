<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import SidePanel from '@any-music/ui/components/SidePanel.vue'
import type { TagManagementPresentation } from '@any-music/ui/theme'
import { computed, shallowRef } from 'vue'

import ClassicCollectionControls from '../library/ClassicCollectionControls.vue'
import ClassicPageOverlays from '../overlays/ClassicPageOverlays.vue'
import TagManagementDialogs from './TagManagementDialogs.vue'
import TagManagementOperator from './TagManagementOperator.vue'
import TagManagementOverview from './TagManagementOverview.vue'
import TagManagementResults from './TagManagementResults.vue'

const props = defineProps<{ editor: TagManagementPresentation; mobileLayout?: boolean }>()
const state = computed(() => props.editor.state)
const displayOpen = shallowRef(false)
const modalOpen = computed(
  () =>
    displayOpen.value ||
    state.value.filterDraft !== null ||
    state.value.detailTag !== null ||
    state.value.mergeOpen ||
    state.value.createOpen,
)
</script>

<template>
  <section
    class="tag-management listen-queue"
    :class="{ 'tag-management--mobile': mobileLayout }"
    aria-label="标签管理"
  >
    <TagManagementOverview :editor="editor" :mobile-layout="mobileLayout">
      <div v-if="state.hasFilters" class="tag-management__criteria" role="status">
        <AppIcon name="filter" :size="16" /><span
          >匹配 {{ state.tagOptions.length }} / {{ state.allTagOptions.length }} 个标签</span
        ><button type="button" @click="editor.actions.resetFilters">清除筛选</button>
      </div>
      <p
        v-if="state.errorMessage && !state.detailTag && !state.mergeOpen"
        class="tag-management__error"
        role="alert"
      >
        {{ state.errorMessage }}
      </p>
      <TagManagementResults :editor="editor" />
    </TagManagementOverview>
    <ClassicPageOverlays :modal-open="modalOpen" :operator-open="state.operatorOpen">
      <template v-if="mobileLayout" #source>
        <span
          class="product-top-bar__queue-count"
          :aria-label="`标签管理共 ${state.allTagOptions.length} 个标签`"
        >
          <strong>{{ state.allTagOptions.length }}</strong> 个
        </span>
      </template>
      <template #toolbar>
        <ClassicCollectionControls
          :selected-count="state.selectedTags.length"
          :total-count="state.tagOptions.length"
          :operator-open="state.operatorOpen"
          :filter-active="state.hasFilters"
          can-display
          filter-label="筛选标签"
          display-label="标签展示方式"
          @display="displayOpen = true"
          @filter="editor.actions.beginFilters"
          @operator="editor.actions.setOperatorOpen(!state.operatorOpen)"
        />
      </template>
      <TagManagementDialogs
        :editor="editor"
        :mobile-layout="mobileLayout"
        :display-open="displayOpen"
        @close-display="displayOpen = false"
      />
      <template #operator
        ><SidePanel
          :open="state.operatorOpen"
          title="标签操作器"
          stacked-actions
          :suspended="modalOpen || state.confirming"
          @close="editor.actions.setOperatorOpen(false)"
          ><TagManagementOperator :editor="editor" /></SidePanel
      ></template>
    </ClassicPageOverlays>
  </section>
</template>
