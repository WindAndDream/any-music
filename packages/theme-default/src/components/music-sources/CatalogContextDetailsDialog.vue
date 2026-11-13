<script setup lang="ts">
import type {
  UiCatalogContextDetailsDialogProps,
  UiCatalogContextDetailsDialogEmits,
} from '@any-music/ui/catalog'
import AppDialog from '@any-music/ui/components/AppDialog.vue'

/** 重命名后的列表名称与原始请求并列展示，长链接保留全文及复制能力。 */
const props = defineProps<UiCatalogContextDetailsDialogProps>()
const emit = defineEmits<UiCatalogContextDetailsDialogEmits>()
</script>

<template>
  <AppDialog
    :open="props.open && Boolean(props.drawer)"
    :suspended="props.suspended"
    title="音乐列表信息"
    size="compact"
    @close="emit('close')"
  >
    <dl v-if="props.drawer" class="catalog-context-details">
      <div class="catalog-context-details__item">
        <dt>列表名称</dt>
        <dd>{{ props.drawer.title }}</dd>
      </div>
      <div class="catalog-context-details__item">
        <dt>{{ props.drawer.kind === 'search' ? '原始搜索词' : '导入链接' }}</dt>
        <dd>{{ props.drawer.input }}</dd>
      </div>
    </dl>
  </AppDialog>
</template>

<style scoped>
.catalog-context-details {
  display: grid;
  gap: var(--am-space-5);
  margin: 0;
}
.catalog-context-details__item {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-2);
}
.catalog-context-details dt {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
.catalog-context-details dd {
  margin: 0;
  color: var(--am-color-text);
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  user-select: text;
}
</style>
