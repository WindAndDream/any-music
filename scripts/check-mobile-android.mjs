import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspectMobileBoundaries } from './check-mobile-boundaries.mjs'
import { androidMinimumApi } from './lib/mobile-android.mjs'

inspectMobileBoundaries()
const ndk = process.env.NDK_HOME
assert(ndk, 'Set NDK_HOME to an installed Android NDK; no device or emulator is started.')
const host = { win32: 'windows-x86_64', linux: 'linux-x86_64', darwin: 'darwin-x86_64' }[
  process.platform
]
assert(host, `Unsupported NDK build host: ${process.platform}`)
const bin = join(ndk, 'toolchains/llvm/prebuilt', host, 'bin')
const linker = join(
  bin,
  `aarch64-linux-android${androidMinimumApi}-clang${process.platform === 'win32' ? '.cmd' : ''}`,
)
const ar = join(bin, `llvm-ar${process.platform === 'win32' ? '.exe' : ''}`)
assert(existsSync(linker) && existsSync(ar), 'Missing Android API 26 arm64 NDK compiler tools')
const result = spawnSync(
  'cargo',
  [
    'clippy',
    '-p',
    'any-music-tauri',
    '--target',
    'aarch64-linux-android',
    '--lib',
    '--locked',
    '--no-default-features',
    '--',
    '-D',
    'warnings',
  ],
  {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'inherit',
    env: {
      ...process.env,
      CC_aarch64_linux_android: linker,
      AR_aarch64_linux_android: ar,
      CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER: linker,
    },
  },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
