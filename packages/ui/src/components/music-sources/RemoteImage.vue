<script setup lang="ts">
import { shallowRef, useTemplateRef, watch } from 'vue'

import { useRemoteImage } from '../../composables/use-remote-image'
import AppIcon from '../AppIcon.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    src: string
    alt: string
    loading?: 'eager' | 'lazy'
    /** HTML 固有尺寸只建立稳定的正方形比例，实际显示尺寸仍由消费组件的 CSS 决定。 */
    width?: number
    height?: number
  }>(),
  { loading: 'lazy', width: 80, height: 80 },
)

const failed = shallowRef(false)
const loaded = shallowRef(false)
const image = useTemplateRef<HTMLImageElement>('image')
const remote = useRemoteImage(
  () => props.src,
  image,
  () => props.loading === 'eager',
)

function handleError(): void {
  if (!remote.fallback()) failed.value = true
}

watch(
  () => props.src,
  () => {
    failed.value = false
  },
)
watch(remote.url, () => {
  loaded.value = false
})
</script>

<template>
  <!--
    音乐源图片默认不发送宿主页面 Referer：否则从抖音等站点打开 B 站 CDN 封面会命中
    防盗链 403。该策略对所有第三方图片统一生效，平台适配器无需保存宿主相关字段。
  -->
  <img
    v-if="!failed"
    ref="image"
    v-bind="$attrs"
    :src="remote.url.value"
    :alt="props.alt"
    :width="props.width"
    :height="props.height"
    referrerpolicy="no-referrer"
    :loading="props.loading"
    decoding="async"
    :style="{ visibility: loaded ? undefined : 'hidden' }"
    @load="loaded = true"
    @error="handleError"
  />
  <span
    v-else
    v-bind="$attrs"
    data-image-state="error"
    role="img"
    :aria-label="`${props.alt}加载失败`"
  >
    <slot><AppIcon name="music" /></slot>
  </span>
</template>
