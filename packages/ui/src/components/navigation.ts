import type { AppIconName } from './app-icon'

/** 侧栏与移动底栏共享同一导航模型，避免不同形态维护两份选中状态。 */
export interface NavigationItem {
  id: string
  label: string
  icon: AppIconName
  /** 待处理数量；零值仍是有效计数。 */
  count?: number
}
