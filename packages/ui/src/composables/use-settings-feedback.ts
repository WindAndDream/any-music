import type { ActionFeedbackResult } from '../product/action-feedback'
import { provideActionFeedback, useActionFeedback } from './use-action-feedback'

/** 保留现有设置消费方的契约；与批量操作复用同一提示服务和文案目录。 */
export type SettingsActionResult = ActionFeedbackResult
export const provideSettingsFeedback = provideActionFeedback
export const useSettingsFeedback = useActionFeedback
