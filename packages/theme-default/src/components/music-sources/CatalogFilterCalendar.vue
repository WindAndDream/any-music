<script setup lang="ts">
import {
  createCatalogCalendarDays,
  getCatalogCalendarToday,
  shiftCatalogCalendarDate,
  shiftCatalogCalendarMonth,
} from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

/** 受控日历；年月日文字同时作为模式入口，六周网格随可用空间铺满，端点与键盘契约不变。 */
const props = defineProps<{ from: string; to: string; stage: 'start' | 'end' }>()
const emit = defineEmits<{ selectDate: [date: string] }>()
const month = defineModel<string>('month', { required: true })
const view = useTemplateRef<HTMLElement>('view')
const mode = shallowRef<'day' | 'month' | 'year'>('day')
const navigationDirection = shallowRef<'forward' | 'back'>('forward')
const yearPageStart = shallowRef(1900)
const today = getCatalogCalendarToday()
const year = computed(() => Number(month.value.slice(0, 4)))
const monthNumber = computed(() => Number(month.value.slice(5, 7)))
const minimumDate = computed(() =>
  props.stage === 'end' ? props.from || '1900-01-01' : '1900-01-01',
)
// 已有结束日期时只允许在它之前调整起始，确保一次操作只改变一个端点。
const maximumDate = computed(() =>
  props.stage === 'start' ? props.to || '2100-12-31' : '2100-12-31',
)
const currentDate = computed(() => (props.stage === 'start' ? props.from : props.to))
const focusDate = computed(() =>
  currentDate.value.startsWith(month.value)
    ? currentDate.value
    : minimumDate.value.startsWith(month.value)
      ? minimumDate.value
      : `${month.value}-01`,
)
// 标题日期与当前网格的键盘落点一致；浏览其他月份时不展示旧端点的无效日期。
const dayNumber = computed(() => Number(focusDate.value.slice(8, 10)))
const modeLabel = computed(() => ({ year: '年份', month: '月份', day: '日期' })[mode.value])
const selectionLabel = computed(() =>
  mode.value === 'year'
    ? `${year.value}年`
    : mode.value === 'month'
      ? `${monthNumber.value}月`
      : `${dayNumber.value}日`,
)
const days = computed(() =>
  createCatalogCalendarDays(month.value).map((date) => ({
    date,
    label: Number(date.slice(8, 10)),
    isOutside: !date.startsWith(month.value),
    // 设置结束时同时标记起止格；切回起始时只显示起始格，结束值仍保留用于范围校验。
    isSelected: date === props.from || (props.stage === 'end' && date === props.to),
    isEdge: date === props.from || (props.stage === 'end' && date === props.to),
    isBetween: Boolean(
      props.stage === 'end' && props.from && props.to && date > props.from && date < props.to,
    ),
    disabled: date < minimumDate.value || date > maximumDate.value,
  })),
)
const years = computed(() =>
  Array.from({ length: 12 }, (_, index) => yearPageStart.value + index).filter(
    (value) => value <= 2100,
  ),
)
const navigationLabel = computed(() =>
  mode.value === 'year'
    ? `${yearPageStart.value} – ${Math.min(yearPageStart.value + 11, 2100)}`
    : mode.value === 'month'
      ? `${year.value} 年`
      : `${year.value} 年 ${monthNumber.value} 月`,
)
const canGoPrevious = computed(() =>
  mode.value === 'year'
    ? yearPageStart.value > Math.max(1900, Number(minimumDate.value.slice(0, 4)))
    : mode.value === 'month'
      ? year.value > Number(minimumDate.value.slice(0, 4))
      : month.value > minimumDate.value.slice(0, 7),
)
const canGoNext = computed(() =>
  mode.value === 'year'
    ? yearPageStart.value + 12 <= Number(maximumDate.value.slice(0, 4))
    : mode.value === 'month'
      ? year.value < Number(maximumDate.value.slice(0, 4))
      : month.value < maximumDate.value.slice(0, 7),
)
const viewKey = computed(() =>
  mode.value === 'year'
    ? `year:${yearPageStart.value}`
    : mode.value === 'month'
      ? `month:${year.value}`
      : `day:${month.value}`,
)

/** 同批年月/模式变更只计算一次方向，快速连续定位不会让过渡方向被中间状态覆盖。 */
watch(
  [mode, month, yearPageStart],
  ([nextMode, nextMonth, nextPage], [oldMode, oldMonth, oldPage]) => {
    const levels = { year: 0, month: 1, day: 2 }
    const isForward =
      nextMode !== oldMode
        ? levels[nextMode] > levels[oldMode]
        : nextMode === 'year'
          ? nextPage > oldPage
          : nextMonth > oldMonth
    navigationDirection.value = isForward ? 'forward' : 'back'
  },
)

/** 离场网格仍参与动画，但立即退出点击与键盘路径；新网格可在同一帧接管焦点。 */
function deactivateLeavingView(element: Element): void {
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}

function activateView(element: Element): void {
  element.removeAttribute('inert')
  element.removeAttribute('aria-hidden')
}

function focusCalendarControl(selector: string): void {
  view.value?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true })
}

watch(
  () => props.stage,
  () => {
    mode.value = 'day'
  },
)

function openYears(): void {
  yearPageStart.value = Math.max(1900, Math.min(2089, year.value - 5))
  mode.value = 'year'
}

function shiftPeriod(offset: -1 | 1): void {
  if ((offset === -1 && !canGoPrevious.value) || (offset === 1 && !canGoNext.value)) return
  if (mode.value === 'year')
    yearPageStart.value = Math.max(1900, Math.min(2089, yearPageStart.value + offset * 12))
  else {
    // 月份网格按年翻页，并按活动端点的上下限约束定位，不联动修改另一个端点。
    const nextMonth = shiftCatalogCalendarMonth(
      month.value,
      offset * (mode.value === 'month' ? 12 : 1),
    )
    month.value =
      nextMonth < minimumDate.value.slice(0, 7)
        ? minimumDate.value.slice(0, 7)
        : nextMonth > maximumDate.value.slice(0, 7)
          ? maximumDate.value.slice(0, 7)
          : nextMonth
  }
}

async function selectYear(value: number): Promise<void> {
  const selectedMonth = `${value}-${String(monthNumber.value).padStart(2, '0')}`
  month.value =
    selectedMonth < minimumDate.value.slice(0, 7)
      ? minimumDate.value.slice(0, 7)
      : selectedMonth > maximumDate.value.slice(0, 7)
        ? maximumDate.value.slice(0, 7)
        : selectedMonth
  mode.value = 'month'
  await nextTick()
  focusCalendarControl(`[data-calendar-month="${monthNumber.value}"]`)
}

async function selectMonth(value: number): Promise<void> {
  month.value = `${year.value}-${String(value).padStart(2, '0')}`
  mode.value = 'day'
  await nextTick()
  focusCalendarControl('[data-calendar-date][tabindex="0"]')
}

function selectDate(date: string): void {
  if (date < minimumDate.value || date > maximumDate.value) return
  month.value = date.slice(0, 7)
  emit('selectDate', date)
}

/** 日期只有一个 Tab 落点；方向键跨月移动，Home/End 定位周边界，PageUp/Down 翻月。 */
async function handleDateKeydown(event: KeyboardEvent, date: string): Promise<void> {
  const dayOffsets: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  }
  let nextDate: string
  if (event.key in dayOffsets) nextDate = shiftCatalogCalendarDate(date, dayOffsets[event.key]!)
  else if (event.key === 'Home' || event.key === 'End') {
    const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
    nextDate = shiftCatalogCalendarDate(date, event.key === 'Home' ? -weekday : 6 - weekday)
  } else if (event.key === 'PageUp' || event.key === 'PageDown') {
    const nextMonth = shiftCatalogCalendarMonth(date.slice(0, 7), event.key === 'PageUp' ? -1 : 1)
    const lastDay = Number(
      shiftCatalogCalendarDate(`${shiftCatalogCalendarMonth(nextMonth, 1)}-01`, -1).slice(8, 10),
    )
    nextDate = `${nextMonth}-${String(Math.min(Number(date.slice(8, 10)), lastDay)).padStart(2, '0')}`
  } else return
  event.preventDefault()
  nextDate =
    nextDate < minimumDate.value
      ? minimumDate.value
      : nextDate > maximumDate.value
        ? maximumDate.value
        : nextDate
  selectDate(nextDate)
  await nextTick()
  focusCalendarControl(`[data-calendar-date="${nextDate}"]`)
}
</script>

<template>
  <section class="catalog-calendar" aria-label="发布时间日历">
    <header class="catalog-calendar__header">
      <div class="catalog-calendar__navigation">
        <button
          class="catalog-calendar__step"
          type="button"
          :disabled="!canGoPrevious"
          :aria-label="mode === 'year' ? '上一组年份' : mode === 'month' ? '上一年' : '上个月'"
          @click="shiftPeriod(-1)"
        >
          <AppIcon name="arrow-left" :size="18" />
        </button>
        <div class="catalog-calendar__heading" role="group" aria-label="选择年、月、日视图">
          <button
            class="catalog-calendar__heading-part"
            type="button"
            :aria-label="`选择年份，${year}年`"
            :aria-pressed="mode === 'year'"
            data-calendar-heading="year"
            @click="openYears"
          >
            {{ year }}年
          </button>
          <button
            class="catalog-calendar__heading-part"
            type="button"
            :aria-label="`选择月份，${monthNumber}月`"
            :aria-pressed="mode === 'month'"
            data-calendar-heading="month"
            @click="mode = 'month'"
          >
            {{ monthNumber }}月
          </button>
          <button
            class="catalog-calendar__heading-part"
            type="button"
            :aria-label="`选择日期，${dayNumber}日`"
            :aria-pressed="mode === 'day'"
            data-calendar-heading="day"
            @click="mode = 'day'"
          >
            {{ dayNumber }}日
          </button>
        </div>
        <button
          class="catalog-calendar__step"
          type="button"
          :disabled="!canGoNext"
          :aria-label="mode === 'year' ? '下一组年份' : mode === 'month' ? '下一年' : '下个月'"
          @click="shiftPeriod(1)"
        >
          <AppIcon name="arrow-right" :size="18" />
        </button>
      </div>
      <p class="catalog-calendar__hint">
        <span class="catalog-calendar__mode">选择模式 · {{ modeLabel }}</span>
        <span class="catalog-calendar__help">点击上方年 / 月 / 日选择时间</span>
      </p>
      <p class="catalog-calendar__selection" aria-live="polite">已选 {{ selectionLabel }}</p>
    </header>
    <div class="catalog-calendar__stage">
      <Transition
        :name="`catalog-calendar-slide-${navigationDirection}`"
        @before-enter="activateView"
        @before-leave="deactivateLeavingView"
        @leave-cancelled="activateView"
      >
        <div
          :key="viewKey"
          ref="view"
          class="catalog-calendar__view"
          :class="{ 'catalog-calendar__view--days': mode === 'day' }"
          data-calendar-view
        >
          <template v-if="mode === 'day'">
            <div class="catalog-calendar__weekdays" aria-hidden="true">
              <span v-for="weekday in ['一', '二', '三', '四', '五', '六', '日']" :key="weekday">{{
                weekday
              }}</span>
            </div>
            <div class="catalog-calendar__days" role="group" aria-label="选择日期">
              <button
                v-for="(day, index) in days"
                :key="day.date"
                type="button"
                class="catalog-calendar__day"
                :class="{
                  'is-outside': day.isOutside,
                  'is-edge': day.isEdge,
                  'is-between': day.isBetween,
                }"
                :disabled="day.disabled"
                :aria-label="`${day.date}${day.date === props.from ? '，起始日期' : ''}${day.date === props.to ? '，结束日期' : ''}`"
                :aria-pressed="day.isSelected"
                :aria-current="day.date === today ? 'date' : undefined"
                :tabindex="day.date === focusDate ? 0 : -1"
                :data-calendar-date="day.date"
                :style="{ '--am-calendar-range-delay': `${Math.min(index % 7, 6) * 12}ms` }"
                @click="selectDate(day.date)"
                @keydown="handleDateKeydown($event, day.date)"
              >
                {{ day.label }}
              </button>
            </div>
          </template>
          <div
            v-else-if="mode === 'month'"
            class="catalog-calendar__periods"
            role="group"
            aria-label="选择月份"
          >
            <button
              v-for="value in 12"
              :key="value"
              type="button"
              :data-calendar-month="value"
              :aria-pressed="value === monthNumber"
              :disabled="
                `${year}-${String(value).padStart(2, '0')}` < minimumDate.slice(0, 7) ||
                `${year}-${String(value).padStart(2, '0')}` > maximumDate.slice(0, 7)
              "
              @click="selectMonth(value)"
            >
              {{ value }} 月
            </button>
          </div>
          <div
            v-else
            class="catalog-calendar__periods"
            role="group"
            :aria-label="`选择年份，${navigationLabel}`"
          >
            <button
              v-for="value in years"
              :key="value"
              type="button"
              :aria-pressed="value === year"
              :disabled="
                value < Number(minimumDate.slice(0, 4)) || value > Number(maximumDate.slice(0, 4))
              "
              @click="selectYear(value)"
            >
              {{ value }} 年
            </button>
          </div>
        </div>
      </Transition>
    </div>
  </section>
</template>

<style scoped>
.catalog-calendar {
  container: am-filter-calendar / inline-size;
  display: grid;
  grid-template-rows: auto minmax(min-content, 1fr);
  gap: var(--am-space-3);
  min-inline-size: 0;
  min-block-size: 0;
  padding: var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface-subtle);
  /* Let the phone detail pane own scrolling, including gestures starting on a date. */
  overflow-x: clip;
  touch-action: pan-y pinch-zoom;
}
.catalog-calendar__header {
  display: grid;
  gap: var(--am-space-1);
  padding-block-end: var(--am-space-3);
  border-block-end: 1px solid var(--am-color-border);
}
.catalog-calendar__navigation {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--am-space-2);
  text-align: center;
}
.catalog-calendar button {
  min-inline-size: 0;
  min-block-size: 44px;
  padding: var(--am-space-2);
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
  text-decoration: none;
}
.catalog-calendar .catalog-calendar__step {
  display: grid;
  place-items: center;
  inline-size: 44px;
  color: var(--am-color-text);
}
.catalog-calendar__heading {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--am-space-1);
  min-inline-size: 0;
  /* 年月日控件继承项目字体，保持与日历数字和其他表单一致。 */
  font-family: var(--am-font-family);
  font-size: clamp(var(--am-font-size-lg), 6cqi, 2.5rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.025em;
  white-space: nowrap;
}
/* 数值标题保留文字外观与细底线，同时提供原生按钮的键盘/触摸等价操作。 */
.catalog-calendar .catalog-calendar__heading-part {
  padding: var(--am-space-1);
  border-block-end: 1px solid var(--am-color-border-strong);
  border-radius: 0;
  font: inherit;
  color: var(--am-color-text);
}
.catalog-calendar .catalog-calendar__heading .catalog-calendar__heading-part[aria-pressed='true'] {
  border-block-end-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
.catalog-calendar__hint,
.catalog-calendar__selection {
  margin: 0;
  text-align: center;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.catalog-calendar__hint {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--am-space-1) var(--am-space-2);
}
.catalog-calendar__mode {
  color: var(--am-color-primary);
  font-weight: 650;
}
.catalog-calendar__weekdays,
.catalog-calendar__days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  text-align: center;
}
.catalog-calendar__weekdays {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.catalog-calendar__stage {
  position: relative;
  display: grid;
  min-block-size: min-content;
  /* Clip sliding views without creating another scroll container. */
  overflow: clip;
}
.catalog-calendar__view {
  display: grid;
  min-block-size: min-content;
  grid-template-rows: minmax(min-content, 1fr);
  gap: var(--am-space-3);
}
.catalog-calendar__view--days {
  grid-template-rows: auto minmax(min-content, 1fr);
}
.catalog-calendar__day {
  position: relative;
  isolation: isolate;
}
.catalog-calendar .catalog-calendar__day {
  min-block-size: 44px;
  font-size: clamp(var(--am-font-size-sm), 3cqi, var(--am-font-size-lg));
}
/* 色块独立缩放/淡入，文字和点击区域不移动；最多 72ms 错峰，不延迟选择结果。 */
.catalog-calendar__day::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 0;
  border-radius: inherit;
  background: var(--am-color-primary-soft);
  opacity: 0;
  transform: scaleX(0.75);
  transition:
    transform var(--am-motion-normal) var(--am-ease-emphasized),
    opacity var(--am-motion-normal) var(--am-ease-standard);
}
.catalog-calendar__day.is-between::before,
.catalog-calendar__day.is-edge::before {
  opacity: 1;
  transform: scaleX(1);
}
.catalog-calendar__day.is-between::before {
  transition-delay: var(--am-calendar-range-delay);
}
.catalog-calendar__day[aria-pressed='true']::before {
  background: var(--am-color-primary);
}
.catalog-calendar__days {
  /* 日期网格随左列高度铺满，字号保持稳定，矮屏仍保留最小点击高度。 */
  grid-template-rows: repeat(6, minmax(44px, 1fr));
  gap: 2px;
}
.catalog-calendar__periods {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(4, minmax(44px, 1fr));
  gap: var(--am-space-2);
}
.catalog-calendar__periods button {
  min-block-size: 44px;
  font-size: clamp(var(--am-font-size-sm), 3cqi, var(--am-font-size-lg));
}
.catalog-calendar button:hover:not(:disabled) {
  background: var(--am-color-hover);
}
.catalog-calendar__day.is-outside {
  color: var(--am-color-text-secondary);
}
.catalog-calendar__day.is-between {
  border-radius: 0;
}
.catalog-calendar__day.is-edge {
  color: var(--am-color-primary);
  font-weight: 700;
}
.catalog-calendar button[aria-pressed='true'] {
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  font-weight: 700;
}
.catalog-calendar .catalog-calendar__day.is-edge,
.catalog-calendar .catalog-calendar__day.is-between,
.catalog-calendar .catalog-calendar__day[aria-pressed='true'] {
  background: transparent;
}
.catalog-calendar .catalog-calendar__day[aria-pressed='true'] {
  color: var(--am-color-on-primary);
  box-shadow: inset 0 0 0 2px var(--am-color-on-primary);
}
.catalog-calendar button:disabled {
  opacity: 0.35;
  cursor: default;
}
.catalog-calendar button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -2px;
}

.catalog-calendar-slide-forward-enter-active,
.catalog-calendar-slide-forward-leave-active,
.catalog-calendar-slide-back-enter-active,
.catalog-calendar-slide-back-leave-active {
  transition:
    transform var(--am-motion-normal) var(--am-ease-emphasized),
    opacity var(--am-motion-normal) var(--am-ease-standard);
}
.catalog-calendar-slide-forward-leave-active,
.catalog-calendar-slide-back-leave-active {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.catalog-calendar-slide-forward-enter-from,
.catalog-calendar-slide-back-leave-to {
  transform: translateX(24px);
  opacity: 0;
}
.catalog-calendar-slide-forward-leave-to,
.catalog-calendar-slide-back-enter-from {
  transform: translateX(-24px);
  opacity: 0;
}

/* 窄列只压缩水平留白；标题字号和 44px 最小点击高度不随宽屏网格拉大。 */
@container am-filter-calendar (max-width: 360px) {
  .catalog-calendar .catalog-calendar__day {
    min-block-size: 44px;
    padding-inline: 0;
  }
  .catalog-calendar__periods button {
    min-block-size: 44px;
  }
  .catalog-calendar__navigation {
    gap: var(--am-space-1);
  }
  .catalog-calendar__heading {
    font-size: var(--am-font-size-lg);
  }
}

/* 辅助留白随高度收紧，但日期/年月选项始终保留 44px 点击高度。 */
@container am-filter-calendar (max-height: 480px) {
  .catalog-calendar__view {
    gap: var(--am-space-2);
  }
}
@container am-filter-calendar (max-height: 360px) {
  .catalog-calendar__heading {
    font-size: var(--am-font-size-lg);
  }
  .catalog-calendar__help {
    display: none;
  }
}
@container am-filter-editor (max-width: 480px) {
  .catalog-calendar {
    padding: var(--am-space-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .catalog-calendar__day::before,
  .catalog-calendar-slide-forward-enter-active,
  .catalog-calendar-slide-forward-leave-active,
  .catalog-calendar-slide-back-enter-active,
  .catalog-calendar-slide-back-leave-active {
    transition: none;
  }
}
</style>
