import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const gitleaksVersion = '8.30.1'
export const gitleaksArchives = {
  'darwin-arm64': [
    'darwin_arm64.tar.gz',
    'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  ],
  'darwin-x64': [
    'darwin_x64.tar.gz',
    'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
  ],
  'linux-arm64': [
    'linux_arm64.tar.gz',
    'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
  ],
  'linux-x64': [
    'linux_x64.tar.gz',
    '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  ],
  'win32-arm64': [
    'windows_arm64.zip',
    'b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f',
  ],
  'win32-x64': [
    'windows_x64.zip',
    'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e',
  ],
}

export function gitleaksPaths(root) {
  const target = `${process.platform}-${process.arch}`
  const release = gitleaksArchives[target]
  if (!release) throw new Error(`Unsupported Gitleaks platform: ${target}`)
  const directory = join(root, '.local', 'privacy-tools', gitleaksVersion, target)
  const executableName = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks'
  return { directory, executable: join(directory, executableName), executableName, release }
}

export function requireGitleaks(root) {
  const { directory, executable } = gitleaksPaths(root)
  const digestPath = join(directory, 'executable.sha256')
  if (!existsSync(executable) || !existsSync(digestPath)) {
    throw new Error('Privacy scanner is missing. Run pnpm privacy:setup before committing.')
  }
  const actual = createHash('sha256').update(readFileSync(executable)).digest('hex')
  if (actual !== readFileSync(digestPath, 'utf8').trim()) {
    throw new Error('Privacy scanner integrity check failed. Run pnpm privacy:setup again.')
  }
  const result = spawnSync(executable, ['version'], { encoding: 'utf8' })
  if (result.status !== 0 || result.stdout.trim() !== gitleaksVersion) {
    throw new Error('Privacy scanner version mismatch. Run pnpm privacy:setup again.')
  }
  return executable
}
