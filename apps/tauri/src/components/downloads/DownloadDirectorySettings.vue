<script setup lang="ts">
import { onMounted } from 'vue'

import { useDownloadDirectory } from '../../features/downloads/use-download-directory'

const props = defineProps<{ platform: 'desktop' | 'android' | 'ios' }>()
const { directory, busy, loaded, error, load, choose, reset } = useDownloadDirectory()
onMounted(load)
</script>

<template>
  <section class="settings-form download-directory" aria-label="下载保存目录" :aria-busy="busy">
    <div class="settings-form__card">
      <div class="settings-form__heading">
        <h4 class="download-directory__title">下载保存目录</h4>
        <p class="settings-form__hint">
          选择后，歌曲与下载压缩包将直接保存到该目录；同名文件会自动编号。未选择时，每次询问保存位置。
        </p>
        <p v-if="props.platform === 'android'" class="settings-form__hint">
          请在系统选择器中选择或新建文件夹，并允许访问。系统可能限制选择存储根目录与 Download
          目录，可选择其子文件夹。
        </p>
      </div>
      <p class="download-directory__value" role="status">
        {{
          loaded ? (directory ?? '每次询问保存位置') : busy ? '正在读取下载目录…' : '下载目录未读取'
        }}
      </p>
      <p v-if="error" class="settings-form__error" role="alert">{{ error.message }}</p>
      <div class="settings-form__footer">
        <button class="settings-form__button" type="button" :disabled="busy" @click="reset">
          每次询问
        </button>
        <button class="settings-form__save" type="button" :disabled="busy" @click="choose">
          {{ directory ? '更改目录' : '选择目录' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.download-directory__title,
.download-directory__value {
  margin: 0;
  overflow-wrap: anywhere;
}
.download-directory__value {
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-background);
}
</style>
