import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { gitleaksPaths, requireGitleaks } from '../lib/gitleaks.mjs'
import {
  inspectPrivacyFile,
  inspectPrivacyText,
  isPrivateDataPath,
  isPublicCommitEmail,
} from '../lib/privacy.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const personalEmail = ['private-person', 'gmail.com'].join('@')
const fakeToken = [
  'ghp',
  createHash('sha256').update('offline privacy regression only').digest('hex').slice(0, 36),
].join('_')
const cacheReady = existsSync(gitleaksPaths(root).executable)

test('privacy rules reject personal paths, mailboxes, phones and forced sensitive files', () => {
  const home = ['C:', 'Users', 'private-person', 'Cookies'].join('/')
  assert.equal(inspectPrivacyText('capture.json', home)[0].rule, 'personal-home-path')
  const unicodeHome = ['C:', 'Users', String.fromCodePoint(0x5f20, 0x4e09), 'data'].join('/')
  assert.equal(inspectPrivacyText('capture.json', unicodeHome)[0].rule, 'personal-home-path')
  assert.equal(inspectPrivacyText('capture.json', personalEmail)[0].rule, 'personal-email')
  assert.equal(
    inspectPrivacyText('capture.json', ['139', '8765', '4321'].join(''))[0].rule,
    'personal-phone',
  )
  assert.equal(
    inspectPrivacyFile(personalEmail + '.txt', Buffer.from('safe'))[0].path,
    '<repository-path>',
  )
  for (const path of [
    '.env',
    '.env.production',
    'cookies.json',
    'account.sqlite3',
    'signing.key',
    'signing.der',
    'recording.har',
    'nested/.local/profile/data',
  ]) {
    assert.equal(isPrivateDataPath(path), true, path)
  }
  for (const path of ['.env.dev', '.env.prod', '.env.staging', '.env.example', 'src/key.ts']) {
    assert.equal(isPrivateDataPath(path), false, path)
  }
  assert.equal(
    inspectPrivacyFile('.env.dev', Buffer.from('UNREVIEWED=value'))[0].rule,
    'public-environment-key',
  )
})

test('binary private keys are rejected even when their filenames hide the export format', () => {
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 })
  for (const [key, type] of [
    [ec.privateKey, 'pkcs8'],
    [ec.privateKey, 'sec1'],
    [rsa.privateKey, 'pkcs1'],
  ]) {
    const bytes = key.export({ format: 'der', type })
    assert.equal(inspectPrivacyFile('capture.bin', bytes)[0].rule, 'binary-private-key')
  }
  assert.deepEqual(
    inspectPrivacyFile('public.bin', ec.publicKey.export({ format: 'der', type: 'spki' })),
    [],
  )
})

test('narrow examples allow reserved domains, public identities and numeric memory evidence', () => {
  const noreply = ['12345+privacy-test', 'users.noreply.github.com'].join('@')
  assert.equal(isPublicCommitEmail(noreply), true)
  assert.equal(isPublicCommitEmail(personalEmail), false)
  assert.equal(
    inspectPrivacyText('capture.json', ['+44', '7700', '900123'].join(''))[0].rule,
    'personal-phone',
  )
  assert.equal(
    inspectPrivacyFile('.env.dev', Buffer.from([0, 1, 2]))[0].rule,
    'binary-environment-file',
  )
  assert.deepEqual(inspectPrivacyText('example.md', ['user', 'example.com'].join('@')), [])
  assert.deepEqual(
    inspectPrivacyText('memory.json', '"memoryBytes": ' + String(17_101_819_904)),
    [],
  )
  assert.deepEqual(inspectPrivacyText('example.md', 'vue@3.5.42 icon@2x.png'), [])
  const workspace = ['X:', 'work', 'private-project'].join('/')
  assert.equal(
    inspectPrivacyText('capture.json', workspace + '/file', { repositoryRoot: workspace })[0].rule,
    'local-workspace-path',
  )
  assert.equal(
    inspectPrivacyText('capture.json', workspace.replaceAll('/', '\\\\') + '\\\\file', {
      repositoryRoot: workspace,
    })[0].rule,
    'local-workspace-path',
  )
})

function fixture(t) {
  const parent = join(root, '.tmp')
  mkdirSync(parent, { recursive: true })
  const directory = mkdtempSync(join(parent, 'privacy-test-'))
  t.after(() => {
    const child = relative(resolve(parent), resolve(directory))
    assert(child && !child.startsWith('..') && !isAbsolute(child))
    rmSync(directory, { recursive: true, force: true })
  })
  const write = (path, value) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    writeFileSync(join(directory, path), value)
  }
  for (const path of [
    'scripts/check-privacy.mjs',
    'scripts/lib/privacy.mjs',
    'scripts/lib/gitleaks.mjs',
    '.gitleaks.toml',
  ]) {
    write(path, readFileSync(join(root, path)))
  }
  write('.gitignore', '.local/\n.env\n')
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  git('init', '--initial-branch=fix/privacy-fixture')
  git('config', 'user.name', 'Privacy Test')
  git('config', 'user.email', ['12345+privacy-test', 'users.noreply.github.com'].join('@'))
  const source = gitleaksPaths(root)
  const target = gitleaksPaths(directory)
  mkdirSync(target.directory, { recursive: true })
  copyFileSync(source.executable, target.executable)
  copyFileSync(
    join(source.directory, 'executable.sha256'),
    join(target.directory, 'executable.sha256'),
  )
  const run = (mode, input, extra = []) =>
    spawnSync(process.execPath, ['scripts/check-privacy.mjs', mode, ...extra], {
      cwd: directory,
      input,
      encoding: 'utf8',
    })
  const commit = (subject = 'test: create offline privacy fixture') => {
    git('add', '--all')
    git('commit', '-m', subject)
    return git('rev-parse', 'HEAD')
  }
  return { directory, write, git, run, commit }
}

test(
  'staged scanning uses index bytes and never prints a detected token',
  { skip: !cacheReady },
  (t) => {
    const f = fixture(t)
    f.write('sample.txt', fakeToken + ' // gitleaks:allow')
    f.git('add', '--all')
    f.write('sample.txt', 'safe working copy\n')
    let result = f.run('staged')
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /value withheld/u)
    assert(!result.stderr.includes(fakeToken))
    f.git('add', 'sample.txt')
    f.write('sample.txt', fakeToken)
    result = f.run('staged')
    assert.equal(result.status, 0, result.stderr)
    result = f.run('worktree')
    assert.equal(result.status, 1)
  },
)

test(
  'forced ignored data, private identity and missing scanner all fail closed',
  { skip: !cacheReady },
  (t) => {
    const f = fixture(t)
    f.git('add', '--all')
    f.write('.env', 'LOCAL_ONLY=value\n')
    f.git('add', '--force', '.env')
    let result = f.run('staged')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /private-data-file/u)
    f.git('rm', '--cached', '.env')
    f.git('config', 'user.email', personalEmail)
    result = f.run('staged')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /noreply/u)
    assert(!result.stderr.includes(personalEmail))
    const target = gitleaksPaths(f.directory)
    rmSync(join(target.directory, 'executable.sha256'))
    result = f.run('worktree')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /scanner is missing/u)
    assert.throws(() => requireGitleaks(f.directory))
  },
)

test(
  'pushed history rejects a secret or mailbox even after a later commit deletes it',
  { skip: !cacheReady },
  (t) => {
    const f = fixture(t)
    const base = f.commit()
    f.write('sample.txt', fakeToken)
    f.commit()
    f.write('sample.txt', 'removed token\n')
    const head = f.commit()
    const update = (sha) =>
      `refs/heads/fix/privacy-fixture ${sha} refs/heads/fix/privacy-fixture ${base}\n`
    let result = f.run('push', update(head))
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /value withheld/u)
    assert(!result.stderr.includes(fakeToken))
    f.write('contact.txt', personalEmail)
    f.commit()
    f.write('contact.txt', 'removed mailbox\n')
    const cleanHead = f.commit()
    result = f.run('push', update(cleanHead))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /personal-email/u)
    assert(!result.stderr.includes(personalEmail))
  },
)

test(
  'Gitleaks keeps real key and source-cookie detection inside acceptance files',
  { skip: !cacheReady },
  (t) => {
    const f = fixture(t)
    const digest = createHash('sha256').update('synthetic baseline checksum').digest('hex')
    f.write('docs/baselines/example.json', JSON.stringify({ 'some-key.ts': digest }, null, 2))
    let result = f.run('worktree')
    assert.equal(result.status, 0, result.stderr)
    f.write('docs/baselines/example.json', JSON.stringify({ api_key: digest }, null, 2))
    result = f.run('worktree')
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /generic-api-key/u)
    f.write('docs/baselines/example.json', JSON.stringify({ SESSDATA: digest }, null, 2))
    result = f.run('worktree')
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /any-music-session-credential/u)
  },
)
