import assert from 'node:assert/strict'

/** pnpm/action-setup uses a Node entry; @pnpm/exe installations expose a native binary. */
export function pnpmInvocation(args, env = process.env) {
  const executable = env.npm_execpath
  assert(executable, 'Run this command through pnpm from the repository root')
  return /\.[cm]?js$/i.test(executable)
    ? { command: process.execPath, args: [executable, ...args] }
    : { command: executable, args }
}
