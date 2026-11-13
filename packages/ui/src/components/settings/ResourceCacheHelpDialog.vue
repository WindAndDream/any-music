<script setup lang="ts">
import AppDialog from '../AppDialog.vue'

defineProps<{
  open: boolean
  suspended?: boolean
  canChooseDirectory?: boolean
  description?: string
}>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <AppDialog
    :open="open"
    :suspended="suspended"
    title="缓存介绍"
    size="compact"
    @close="emit('close')"
  >
    <div class="resource-cache-help">
      <section class="settings-form__heading">
        <h4>硬盘缓存</h4>
        <p class="settings-form__hint">
          自动缓存浏览过的图片、封面与播放时读取的歌曲片段，空间不足时优先清理近期未使用的内容。最低
          128 MiB，最高 100 GiB，默认 1 GiB。缩小容量会立即淘汰多余缓存。
        </p>
        <p class="settings-form__hint">
          占用统计包含索引预留空间，系统文件开销可能略有差异。缓存不是离线下载，仍需获取歌曲的当前播放权限。
        </p>
      </section>
      <section class="settings-form__heading">
        <h4>内存缓存</h4>
        <p class="settings-form__hint">
          在本次运行期间复用最近读取的图片与歌曲片段，减少重复读取硬盘缓存。默认 64 MiB，最高 1024
          MiB；设为 0
          可关闭，缩小上限会立即释放多余缓存。关闭应用或页面后释放缓存内容，仅保留容量设置。
        </p>
        <p class="settings-form__hint">
          上限不会预先占用等量内存。统计包含缓存数据与元数据预留空间，不代表应用总内存；浏览器或系统的播放缓冲、图片解码和正在使用的资源另行管理。
        </p>
      </section>
      <section class="settings-form__heading">
        <h4>位置与清理</h4>
        <p class="settings-form__hint">
          {{
            canChooseDirectory
              ? '更改目录会清理旧缓存，新资源将在新目录重新缓存。'
              : '由运行端管理专属缓存空间，无法选择任意磁盘目录。'
          }}清除缓存会同时释放硬盘与内存缓存，正在使用的资源可能随后产生新的缓存。歌曲库、下载文件和创作者资料不受影响。
        </p>
        <p v-if="description" class="settings-form__hint">{{ description }}</p>
      </section>
    </div>
  </AppDialog>
</template>

<style scoped>
.resource-cache-help {
  display: grid;
  gap: var(--am-space-5);
}
.resource-cache-help h4 {
  font-size: var(--am-font-size-sm);
}
</style>
