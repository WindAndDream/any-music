import { AppError } from '@any-music/core'
import type { AppErrorCode } from '@any-music/core'

import type { AccountOperation } from './account-runtime'

/** A preflight failure still owns a concrete identity, even before an attempt starts. */
export class AccountOperationError extends AppError {
  readonly accountId: string
  readonly operation: AccountOperation
  constructor(code: AppErrorCode, message: string, accountId: string, operation: AccountOperation) {
    super(code, message)
    this.accountId = accountId
    this.operation = operation
  }
}
