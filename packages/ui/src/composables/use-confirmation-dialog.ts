import {
  computed,
  inject,
  onScopeDispose,
  provide,
  shallowRef,
  type ComputedRef,
  type InjectionKey,
} from 'vue'

export type ConfirmationTone = 'default' | 'danger'

export interface ConfirmationRequest {
  title: string
  message: string
  details?: readonly { label: string; text: string }[]
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmationTone
}

export interface ActiveConfirmationRequest {
  id: number
  title: string
  message: string
  details?: ConfirmationRequest['details']
  confirmLabel: string
  cancelLabel: string
  tone: ConfirmationTone
  /** 在底层弹层被 inert 前捕获真实触发点，供确认框关闭后恢复键盘焦点。 */
  returnFocusTarget?: HTMLElement
}

export type ConfirmAction = (request: ConfirmationRequest) => Promise<boolean>

export interface ConfirmationDialogController {
  activeRequest: ComputedRef<ActiveConfirmationRequest | undefined>
  confirm: ConfirmAction
  accept: () => void
  cancel: () => void
  dispose: () => void
}

const confirmActionKey: InjectionKey<ConfirmAction> = Symbol('any-music-confirm-action')

let nextRequestId = 0

function getDeepActiveElement(): HTMLElement | undefined {
  // 控制器也在无 DOM 的单元测试中运行；焦点来源只属于浏览器增强契约。
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') return undefined
  let activeElement: Element | null = document.activeElement
  while (activeElement instanceof HTMLElement && activeElement.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement
  }
  return activeElement instanceof HTMLElement ? activeElement : undefined
}

/**
 * 创建单宿主确认服务。原生 confirm 会阻塞新的点击；自定义弹层用“忙时取消新请求”复现该边界，
 * 避免快速连点把已经过期的删除动作排队到后续执行。
 */
export function createConfirmationDialogController(): ConfirmationDialogController {
  const activeRequestState = shallowRef<ActiveConfirmationRequest>()
  let resolveActiveRequest: ((result: boolean) => void) | undefined
  let isDisposed = false

  const activeRequest = computed(() => activeRequestState.value)

  const confirm: ConfirmAction = (request) => {
    if (isDisposed || activeRequestState.value) return Promise.resolve(false)

    activeRequestState.value = {
      id: ++nextRequestId,
      title: request.title,
      message: request.message,
      details: request.details?.map((detail) => ({ ...detail })),
      confirmLabel: request.confirmLabel ?? '确认',
      cancelLabel: request.cancelLabel ?? '取消',
      tone: request.tone ?? 'default',
      returnFocusTarget: getDeepActiveElement(),
    }

    return new Promise<boolean>((resolve) => {
      resolveActiveRequest = resolve
    })
  }

  function settle(result: boolean): void {
    const resolve = resolveActiveRequest
    if (!resolve) return
    resolveActiveRequest = undefined
    activeRequestState.value = undefined
    resolve(result)
  }

  function dispose(): void {
    isDisposed = true
    settle(false)
  }

  return {
    activeRequest,
    confirm,
    accept: () => settle(true),
    cancel: () => settle(false),
    dispose,
  }
}

/** 在正式产品根作用域注册一次服务，所有异步功能面板都复用同一个 Shadow 内弹层。 */
export function provideConfirmationDialog(): ConfirmationDialogController {
  const controller = createConfirmationDialogController()
  provide(confirmActionKey, controller.confirm)
  onScopeDispose(controller.dispose)
  return controller
}

/** 删除、覆盖等局部组件通过注入获取确认能力，不再依赖宿主页的同步确认弹窗。 */
export function useConfirmAction(): ConfirmAction {
  const confirm = inject(confirmActionKey)
  if (!confirm) throw new Error('Confirmation dialog provider is missing.')
  return confirm
}
