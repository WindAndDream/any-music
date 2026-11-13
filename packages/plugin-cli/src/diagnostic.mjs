/** Tool failures are not product AppError codes. Never serialize raw upstream errors/paths. */
export class Diagnostic extends Error {
  constructor(code, path, message, suggestion, exitCode = 1) {
    super(message)
    this.diagnostic = { code, path, message, suggestion }
    this.exitCode = exitCode
  }
}
export function refuse(
  code,
  path,
  message,
  suggestion = 'Use the supported SDK/Profile contract.',
  exitCode = 1,
) {
  throw new Diagnostic(code, path, message, suggestion, exitCode)
}
