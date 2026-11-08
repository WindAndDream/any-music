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

import { gitleaksPaths, gitleaksVersion, requireGitleaks } from './lib/gitleaks.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const { directory, executable, executableName, release } = gitleaksPaths(root)
try {
  requireGitleaks(root)
  console.log(`Gitleaks ${gitleaksVersion} is ready`)
} catch {
  mkdirSync(directory, { recursive: true })
  const temporary = mkdtempSync(join(directory, 'install-'))
  try {
    const archiveName = `gitleaks_${gitleaksVersion}_${release[0]}`
    const response = await fetch(
      `https://github.com/gitleaks/gitleaks/releases/download/v${gitleaksVersion}/${archiveName}`,
      { signal: AbortSignal.timeout(120_000) },
    )
    if (!response.ok) throw new Error(`Gitleaks download failed: HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex') !== release[1]) {
      throw new Error('Gitleaks archive SHA-256 does not match the reviewed release')
    }
    const archive = join(temporary, archiveName)
    writeFileSync(archive, bytes)
    execFileSync('tar', ['-xf', archive, '-C', temporary, executableName], { stdio: 'pipe' })
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
