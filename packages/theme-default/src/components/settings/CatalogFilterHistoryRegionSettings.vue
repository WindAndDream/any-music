<script setup lang="ts">
import { MAX_CATALOG_FILTER_HISTORY_LIMIT } from '@any-music/ui'
import type { CatalogFilterHistoryPreferencesDraft } from '@any-music/ui'
import type { FilterHistorySettingsRegion } from '@any-music/ui'
import { getCatalogFilterDimensions, type CatalogTrackFilterDimension } from '@any-music/ui'
import { computed, useId } from 'vue'

/** 一个筛选区域的受控配置；每次输入替换草稿，不直接修改父级对象。 */
const props = defineProps<{ region: FilterHistorySettingsRegion; describedBy: string }>()
const model = defineModel<CatalogFilterHistoryPreferencesDraft>({ required: true })
const formId = useId()
const dimensions = computed(() => getCatalogFilterDimensions(props.region.context))

function updateLimit(dimension: CatalogTrackFilterDimension, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  model.value = { ...model.value, limits: { ...model.value.limits, [dimension]: value } }
}

function updateCollapseAfter(event: Event): void {
  model.value = { ...model.value, collapseAfter: (event.target as HTMLInputElement).value }
}
</script>

<template>
  <fieldset
    class="filter-history-region settings-sections"
    :data-filter-history-context="props.region.context"
    :aria-describedby="props.describedBy"
  >
    <legend class="am-sr-only">{{ props.region.title }}</legend>
    <section
      class="filter-history-region__retention"
      :aria-labelledby="`${formId}-retention-title`"
    >
      <div class="filter-history-region__heading">
        <div>
          <h3 :id="`${formId}-retention-title`">历史保留</h3>
          <p class="settings-form__hint">每项独立设置，0 表示不保留。</p>
        </div>
        <span class="filter-history-region__range">0–100 组</span>
      </div>
      <div class="settings-form__card filter-history-region__fields">
        <label
          v-for="dimension in dimensions"
          :key="dimension.id"
          class="settings-form__field filter-history-region__field"
        >
          <span class="filter-history-region__label">
            <strong>{{ dimension.label }}</strong>
          </span>
          <span class="filter-history-region__number">
            <input
              :value="model.limits[dimension.id]"
              :data-am-focus-key="`settings:filter-history:${props.region.context}:${dimension.id}`"
              :name="`${props.region.context}-${dimension.id}-limit`"
              :aria-label="`${props.region.title} · ${dimension.label}保留数量`"
              type="number"
              min="0"
              :max="MAX_CATALOG_FILTER_HISTORY_LIMIT"
              step="1"
              inputmode="numeric"
              required
              :aria-describedby="props.describedBy"
              @input="updateLimit(dimension.id, $event)"
            />
            <small aria-hidden="true">组</small>
          </span>
        </label>
      </div>
    </section>
    <section class="filter-history-region__display" :aria-labelledby="`${formId}-display-title`">
      <div class="filter-history-region__heading">
        <div>
          <h3 :id="`${formId}-display-title`">默认展示</h3>
          <p :id="`${formId}-display`" class="settings-form__hint">超出部分可展开查看。</p>
        </div>
        <span class="filter-history-region__range">1–100 组</span>
      </div>
      <div class="settings-form__card filter-history-region__fields">
        <label class="settings-form__field filter-history-region__field">
          <span class="filter-history-region__label">
            <strong>默认显示数量</strong>
            <small>本区域每项历史</small>
          </span>
          <span class="filter-history-region__number">
            <input
              :value="model.collapseAfter"
              :data-am-focus-key="`settings:filter-history:${props.region.context}:collapse-after`"
              :name="`${props.region.context}-collapse-after`"
              :aria-label="`${props.region.title} · 每项历史默认显示数量`"
              type="number"
              min="1"
              :max="MAX_CATALOG_FILTER_HISTORY_LIMIT"
              step="1"
              inputmode="numeric"
              required
              :aria-describedby="`${formId}-display ${props.describedBy}`"
              @input="updateCollapseAfter"
            />
            <small aria-hidden="true">组</small>
          </span>
        </label>
      </div>
    </section>
  </fieldset>
</template>

<style scoped>
.filter-history-region {
  display: grid;
  min-inline-size: 0;
  gap: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.filter-history-region__retention,
.filter-history-region__display {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-3);
}
.filter-history-region__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--am-space-3);
}
.filter-history-region__heading h3 {
  margin: 0 0 var(--am-space-1);
  font-size: var(--am-font-size-sm);
  font-weight: 700;
}
.filter-history-region__range {
  flex-shrink: 0;
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* 数量字段通过对齐与留白分行，分隔线仅放在历史保留和默认展示两个子项之间。 */
.filter-history-region__fields {
  gap: 0;
  padding-block: 0;
}
.filter-history-region__field {
  grid-template-columns: minmax(0, 1fr) minmax(120px, 144px);
  align-items: center;
  gap: var(--am-space-4);
  padding-block: var(--am-space-4);
}
.filter-history-region__label {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-1);
  overflow-wrap: anywhere;
}
.filter-history-region__label small,
.filter-history-region__number small {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-weight: 400;
}
.filter-history-region__number {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-2);
}
.filter-history-region__number input {
  font-variant-numeric: tabular-nums;
}
/* 以表单实际宽度重排，兼顾 PC 侧栏挤压与手机子页，不依赖设备型号。 */
@container am-filter-history-settings (max-width: 400px) {
  .filter-history-region__field {
    grid-template-columns: minmax(0, 1fr) minmax(100px, 120px);
    gap: var(--am-space-3);
  }
}
@container am-filter-history-settings (max-width: 300px) {
  .filter-history-region__field {
    grid-template-columns: minmax(0, 1fr);
  }
  .filter-history-region__heading {
    flex-wrap: wrap;
  }
}
</style>
