<script setup lang="ts">
import { nextTick, onMounted, useTemplateRef, watch } from 'vue'

import { containModalTab } from '../modal-focus'

/** Host-owned recovery has no contribution, theme or allocator dependency. */
const props = defineProps<{ busy: boolean; hasFailure: boolean }>()
defineEmits<{ retry: []; safeStart: []; restoreDefaultTheme: [] }>()
const panel = useTemplateRef<HTMLElement>('panel')
async function focusPanel(): Promise<void> {
  await nextTick()
  panel.value?.focus({ preventScroll: true })
}
onMounted(focusPanel)
watch(
  () => props.busy,
  (busy) => {
    // A running recovery disables every button; keep focus in its still-usable host region.
    if (busy) void focusPanel()
  },
)
</script>

<template>
  <section
    ref="panel"
    class="am-module-recovery"
    aria-label="系统模块恢复"
    role="alert"
    :aria-busy="busy ? 'true' : undefined"
    tabindex="-1"
    @keydown="containModalTab($event, panel)"
  >
    <h1>{{ hasFailure ? '系统模块启动失败' : '系统模块恢复' }}</h1>
    <p>可以重新加载，或禁用可选模块并恢复默认主题后启动。资料库与下载记录会保留。</p>
    <div class="am-module-recovery__actions">
      <button type="button" :disabled="busy" @click="$emit('retry')">重新加载</button>
      <button type="button" :disabled="busy" @click="$emit('safeStart')">安全启动</button>
      <button type="button" :disabled="busy" @click="$emit('restoreDefaultTheme')">
        恢复默认主题
      </button>
    </div>
  </section>
</template>

<style scoped>
.am-module-recovery {
  box-sizing: border-box;
  min-block-size: 100%;
  padding: 24px;
  color: var(--am-color-text, #202124);
  background: var(--am-color-background, #fff);
  font:
    16px/1.6 system-ui,
    sans-serif;
}
.am-module-recovery__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
button {
  min-height: 44px;
  padding: 8px 16px;
  color: inherit;
  background: transparent;
  border: 1px solid currentColor;
  border-radius: var(--am-radius-control, 6px);
  font: inherit;
  cursor: pointer;
}
</style>
