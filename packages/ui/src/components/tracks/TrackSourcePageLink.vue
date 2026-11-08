<script setup lang="ts">
import type { Track } from '@any-music/core'

// 原页入口只消费标准 Track 引用，所有板块共享同一套新窗口与隐私语义。
const props = defineProps<{
  track: Track
}>()
</script>

<template>
  <a
    v-if="props.track.source.pageUrl"
    class="track-source-page-link"
    :href="props.track.source.pageUrl"
    target="_blank"
    rel="noopener noreferrer"
    :title="`打开《${props.track.title}》的来源原页`"
  >
    原页
  </a>
</template>
