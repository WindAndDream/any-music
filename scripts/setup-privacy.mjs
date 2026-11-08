import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  downloadGitleaksArchive,
  gitleaksPaths,
  gitleaksVersion,
  requireGitleaks,
} from './lib/gitleaks.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const { directory, executable, executableName, release } = gitleaksPaths(root)
try {
  requireGitleaks(root)
  console.log(`Gitleaks ${gitleaksVersion} is ready`)
} catch {
  mkdirSync(directory, { recursive: true })
  const temporary = mkdtempSync(join(directory, 'install-'))
  try {
    const { archiveName, bytes } = await downloadGitleaksArchive(release)
    writeFileSync(join(temporary, archiveName), bytes)
    // Git Bash can put GNU tar ahead of the Windows tool that supports ZIP archives.
    const tar =
      process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar'
    execFileSync(tar, ['-xf', archiveName, executableName], { cwd: temporary, stdio: 'pipe' })
    copyFileSync(join(temporary, executableName), executable)
    if (process.platform !== 'win32') chmodSync(executable, 0o755)
    writeFileSync(
      join(directory, 'executable.sha256'),
      createHash('sha256').update(readFileSync(executable)).digest('hex') + '\n',
    )
    requireGitleaks(root)
    console.log(`Installed verified Gitleaks ${gitleaksVersion}`)
  } finally {
    const child = relative(resolve(directory), resolve(temporary))
    if (child && !child.startsWith('..') && !isAbsolute(child)) {
      rmSync(temporary, { recursive: true, force: true })
    }
  }
}
