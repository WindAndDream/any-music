<script setup lang="ts">
import { useId } from 'vue'

/** 创作者身份表单仅编辑显示名，稳定 ID 是只读的导入/导出身份契约。 */
const props = defineProps<{ userId: string; errorMessage?: string }>()
const displayName = defineModel<string>({ required: true })
const emit = defineEmits<{ save: [] }>()
const formId = useId()
</script>

<template>
  <form class="settings-form" novalidate @submit.prevent="emit('save')">
    <div class="settings-form__card settings-form__fields">
      <label class="settings-form__field">
        <span>显示名称</span>
        <input
          v-model="displayName"
          data-am-focus-key="settings:creator-profile:name"
          maxlength="80"
          autocomplete="nickname"
          required
          :aria-invalid="props.errorMessage ? true : undefined"
          :aria-describedby="props.errorMessage ? `${formId}-error` : undefined"
        />
      </label>
      <label class="settings-form__field">
        <span class="settings-form__heading">
          <strong>稳定用户 ID</strong>
          <small class="settings-form__hint"
            >用户 ID 不随名称修改，用于歌单导入与导出。来源博主信息会单独写入每首拼接作品。</small
          >
        </span>
        <input :value="props.userId" readonly />
      </label>
      <p
        v-if="props.errorMessage"
        :id="`${formId}-error`"
        class="settings-form__error"
        role="alert"
      >
        {{ props.errorMessage }}
      </p>
      <div class="settings-form__footer">
        <button class="settings-form__save" type="submit">保存创作者名称</button>
      </div>
    </div>
  </form>
</template>
