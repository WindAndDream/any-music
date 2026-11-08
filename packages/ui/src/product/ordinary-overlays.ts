import type { AppIconName } from '../components/app-icon'
import type { ActiveConfirmationRequest } from '../composables/use-confirmation-dialog'
import type { ActionFeedbackTone } from './action-feedback'

/** Product feedback only; native installation, consent and recovery are separate host surfaces. */
export interface OrdinaryOverlaysProps {
  request?: ActiveConfirmationRequest
  notice?: { message?: string; tone?: ActionFeedbackTone; icon?: AppIconName; id?: number }
}
export interface OrdinaryOverlaysEmits {
  confirm: [requestId: number]
  cancel: [requestId: number]
  noticePauseChange: [isPaused: boolean]
}
