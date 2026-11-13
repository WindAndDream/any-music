import type { AppThemePreference, SidebarSide } from '@any-music/ui'

interface PreferenceOption<Value extends string> {
  value: Value
  label: string
  description: string
}

export const sidebarSideOptions: readonly PreferenceOption<SidebarSide>[] = [
  { value: 'left', label: '左侧', description: '侧栏和移动端抽屉位于左侧。' },
  { value: 'right', label: '右侧', description: '侧栏和移动端抽屉位于右侧。' },
]

export const themeOptions: readonly PreferenceOption<AppThemePreference>[] = [
  { value: 'system', label: '跟随系统', description: '随系统外观自动切换浅色与深色。' },
  { value: 'light', label: '浅色', description: '使用明亮背景和深色文字。' },
  { value: 'dark', label: '深色', description: '使用深色背景和浅色文字。' },
]
