import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { requireGitleaks } from './lib/gitleaks.mjs'
import { inspectPrivacyFile, inspectPrivacyText } from './lib/privacy.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mode = process.argv[2] ?? 'worktree'
const git = (args, options = {}) =>
  execFileSync('git', args, {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  })
const lines = (buffer) => buffer.toString('utf8').trim().split('\n').filter(Boolean)
const oid = (value) => {
  if (!/^[a-f\d]{40,64}$/u.test(value))
    throw new Error('Invalid commit identity supplied to privacy check')
  return value
}

function readBlobs(entries) {
  const ids = [...new Set(entries.map((entry) => entry.oid))]
  if (!ids.length) return []
  const data = git(['cat-file', '--batch'], { input: ids.join('\n') + '\n' })
  const blobs = new Map()
  let offset = 0
  for (const id of ids) {
    const end = data.indexOf(10, offset)
    const [actual, type, sizeText] = data.subarray(offset, end).toString('ascii').split(' ')
    const size = Number(sizeText)
    if (actual !== id || type !== 'blob' || !Number.isSafeInteger(size)) {
      throw new Error(
        'Cannot inspect Git object; unresolved entries and submodules are not admitted',
      )
    }
    offset = end + 1
    blobs.set(id, data.subarray(offset, offset + size))
    offset += size + 1
  }
  return entries.map((entry) => ({ path: entry.path, bytes: blobs.get(entry.oid) }))
}

function snapshot() {
  if (mode === 'staged') {
    const entries = git(['ls-files', '--stage', '-z'])
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .map((row) => {
        const match = /^(\d+) ([a-f\d]+) (\d)\t([\s\S]+)$/u.exec(row)
        if (!match || match[3] !== '0' || !['100644', '100755'].includes(match[1])) {
          throw new Error('Resolve conflicts and review unsupported Git entries before committing')
        }
        return { oid: match[2], path: match[4] }
      })
    return readBlobs(entries)
  }
  const paths = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  return [...new Set(paths)]
    .filter((path) => existsSync(join(root, path)))
    .map((path) => {
      if (!lstatSync(join(root, path)).isFile())
        throw new Error('Privacy scan requires regular repository files')
      return { path, bytes: readFileSync(join(root, path)) }
    })
}

function report(findings) {
  for (const { path, line, rule } of findings)
    console.error(`${path}:${line}: ${rule} (value withheld)`)
  if (findings.length)
    throw new Error(
      `Privacy check rejected ${findings.length} finding(s); sanitize the data before committing`,
    )
}

function cleanTemporary(directory, base) {
  const child = relative(resolve(base), resolve(directory))
  if (!child || child.startsWith('..') || isAbsolute(child))
    throw new Error('Refusing cleanup outside the privacy cache')
  rmSync(directory, { recursive: true, force: true })
}

function scanSecrets(scanner, args, input) {
  const cache = join(root, '.local', 'privacy-scan')
  mkdirSync(cache, { recursive: true })
  const temporary = mkdtempSync(join(cache, 'scan-'))
  try {
    const reportPath = join(temporary, 'findings.json')
    let scanArgs = args
    if (Array.isArray(input)) {
      const directory = join(temporary, 'files')
      mkdirSync(directory)
      for (const file of input) {
        const target = resolve(directory, file.path)
        const child = relative(directory, target)
        if (!child || child.startsWith('..') || isAbsolute(child))
          throw new Error('Invalid repository path')
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, file.bytes)
      }
      scanArgs = ['dir', directory]
    }
    const result = spawnSync(
      scanner,
      [
        ...scanArgs,
        '--config',
        join(root, '.gitleaks.toml'),
        '--redact=100',
        '--no-banner',
        '--no-color',
        '--ignore-gitleaks-allow',
        '--gitleaks-ignore-path',
        temporary,
        '--report-format=json',
        '--report-path',
        reportPath,
      ],
      {
        cwd: root,
        input: typeof input === 'string' ? input : undefined,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      },
    )
    if (result.error || ![0, 1].includes(result.status)) {
      throw new Error('Gitleaks could not complete; privacy verification fails closed')
    }
    const findings = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : []
    report(
      findings.map((finding) => ({
        path: finding.File
          ? finding.File.replaceAll('\\', '/').replace(
              temporary.replaceAll('\\', '/') + '/files/',
              '',
            )
          : '<commit-message>',
        line: finding.StartLine,
        rule: finding.RuleID,
      })),
    )
    if (result.status !== 0) throw new Error('Gitleaks rejected the snapshot')
  } finally {
    cleanTemporary(temporary, cache)
  }
}

function inspectCommitMessage(path, message) {
  // GitHub adds this public sign-off to Dependabot commits. Keep scanning all other text.
  return inspectPrivacyText(
    path,
    message.replace(/^Signed-off-by: dependabot\[bot\] <support@github\.com>$/gmu, ''),
    { repositoryRoot: root },
  )
}

function inspectCommits(revisions, scanner) {
  const commits = lines(git(['rev-list', ...revisions]))
  const entries = new Map()
  for (const commit of commits) {
    // Git commit author/committer email is public metadata, not repository content.
    // Continue scanning commit messages, changed blobs, and full history for secrets.
    const message = git(['show', '-s', '--format=%B', commit]).toString('utf8')
    report(inspectCommitMessage(`<commit ${commit.slice(0, 12)}>`, message))
    const changes = git([
      'diff-tree',
      '--root',
      '-r',
      '-m',
      '--no-renames',
      '--no-commit-id',
      '--raw',
      '-z',
      commit,
    ])
      .toString('utf8')
      .split('\0')
    for (let index = 0; index < changes.length - 1; index += 2) {
      const header = changes[index].split(' ')
      const path = changes[index + 1]
      if (header[4] === 'D') continue
      if (!['100644', '100755'].includes(header[1]))
        throw new Error('Unsupported Git entry in pushed commits')
      entries.set(`${header[3]}:${path}`, { oid: header[3], path })
    }
  }
  for (const file of readBlobs([...entries.values()]))
    report(inspectPrivacyFile(file.path, file.bytes, { repositoryRoot: root }))
  if (commits.length)
    scanSecrets(scanner, ['git', root, `--log-opts=${revisions.join(' ')} --full-history -m`])
  return commits.length
}

try {
  const scanner = requireGitleaks(root)
  if (mode === 'message') {
    const message = readFileSync(process.argv[3], 'utf8')
    report(inspectCommitMessage('<commit-message>', message))
    scanSecrets(scanner, ['stdin'], message)
  } else if (mode === 'history') {
    scanSecrets(scanner, ['git', root, '--log-opts=--all --full-history -m'])
  } else if (mode === 'push') {
    const remote = process.argv[3] ?? 'origin'
    if (!/^[a-z\d][a-z\d._/-]*$/iu.test(remote)) throw new Error('Invalid remote name')
    for (const line of lines(readFileSync(0))) {
      const [, local, , previous] = line.split(/\s+/u)
      oid(local)
      oid(previous)
      if (/^0+$/u.test(local)) continue
      const revisions = /^0+$/u.test(previous)
        ? [local, '--not', `--remotes=${remote}`]
        : [`${previous}..${local}`]
      inspectCommits(revisions, scanner)
    }
  } else if (['worktree', 'staged', 'ci'].includes(mode)) {
    const files = snapshot()
    report(
      files.flatMap((file) => inspectPrivacyFile(file.path, file.bytes, { repositoryRoot: root })),
    )
    scanSecrets(scanner, [], files)
    if (mode === 'ci') {
      scanSecrets(scanner, ['git', root, '--log-opts=--all --full-history -m'])
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
      const pr = event.pull_request
      const revisions = pr
        ? [`${oid(pr.base.sha)}..${oid(pr.head.sha)}`]
        : event.before && !/^0+$/u.test(event.before)
          ? [`${oid(event.before)}..${oid(event.after)}`]
          : [oid(git(['rev-parse', 'HEAD']).toString('utf8').trim())]
      // A new repository/push can have an empty before; inspect its complete history.
      inspectCommits(revisions, scanner)
    }
    console.log(
      `Privacy check passed for ${files.length} ${mode === 'staged' ? 'index' : 'working-tree'} files`,
    )
  } else {
    throw new Error(
      'Usage: check-privacy.mjs worktree|staged|message <file>|history|push <remote>|ci',
    )
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
