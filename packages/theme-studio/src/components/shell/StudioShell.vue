<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { UiThemeFeatureMap, UiThemeForm } from '@any-music/ui/theme'

defineProps<{ feature: UiThemeFeatureMap['shell']; form?: UiThemeForm; modalOpen?: boolean }>()
defineSlots<{
  default?: () => unknown
  navigation?: () => unknown
  player?: () => unknown
  overlays?: () => unknown
}>()
</script>

<template>
  <section
    class="am-theme-studio studio-shell"
    :data-form="form"
    :data-theme="feature.state.resolvedTheme ?? 'light'"
    :data-presentation="feature.state.presentation ?? 'embedded'"
    :data-hidden="feature.state.hidden"
    aria-label="Any Music 工作室"
  >
    <template v-if="!feature.state.hidden">
      <div
        class="studio-shell-body"
        :inert="modalOpen ? true : undefined"
        :aria-hidden="modalOpen ? true : undefined"
      >
        <header class="studio-masthead">
          <strong class="studio-brand"
            ><AppIcon name="waveform" /> Any Music <small>工作室</small></strong
          >
          <button
            type="button"
            aria-label="打开全局设置"
            data-am-focus-key="settings:open"
            :disabled="feature.availability.status !== 'available'"
            @click="feature.actions.openSettings()"
          >
            <AppIcon name="settings" /> 设置
          </button>
          <button
            v-if="feature.state.canHide"
            type="button"
            aria-label="隐藏 Any Music"
            @click="feature.actions.hide"
          >
            <AppIcon name="hide" /> 隐藏
          </button>
        </header>
        <slot name="navigation" />
        <p v-if="feature.availability.status !== 'available'" role="status">
          {{ feature.availability.reason }}
        </p>
        <div class="studio-desk" data-am-scroll-key="workspace">
          <main
            class="studio-content"
            tabindex="-1"
            data-am-focus-key="workbench:content"
            data-am-scroll-key="workspace"
          >
            <slot />
          </main>
          <aside class="studio-console" aria-label="播放控制台"><slot name="player" /></aside>
        </div>
      </div>
      <slot name="overlays" />
    </template>
    <button v-else type="button" data-am-focus-key="workbench:show" @click="feature.actions.show">
      显示 Any Music
    </button>
  </section>
</template>
