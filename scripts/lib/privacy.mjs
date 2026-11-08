/** Repository privacy rules supplement Gitleaks without printing matched values. */
import { createPrivateKey } from 'node:crypto'

const publicEnvironmentFiles = new Set(['.env.dev', '.env.prod', '.env.staging'])
const exampleUsers = new Set(['user', 'example', 'runner', 'runneradmin', 'web_user'])
const examplePhones = new Set([
  '13812345678',
  '13800138000',
  '13800000000',
  '+8613800138000',
  '8613800138000',
  '+8613800000000',
  '+86 13800000000',
])
const imageSuffixes = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'])

export function isPrivateDataPath(path) {
  const normalized = path.replaceAll('\\', '/')
  if (publicEnvironmentFiles.has(normalized)) return false
  if (/(?:^|\/)\.env(?:\.example|\.template)$/u.test(normalized)) return false
  return (
    /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.netrc|\.pypirc|\.npmrc|id_rsa|id_ed25519|Login Data|Cookies|Local State|credentials(?:\.json)?|cookies?\.(?:json|txt))$/iu.test(
      normalized,
    ) ||
    /\.(?:pem|der|key|p12|pfx|jks|keystore|sqlite3?|db|har|pcap|dmp)$/iu.test(normalized) ||
    /(?:\.(?:jks|keystore)\.b64|(?:^|\/)ANDROID_KEYSTORE_BASE64\.txt)$/iu.test(normalized) ||
    /(?:^|\/)(?:\.local|logs|\.tmp|\.codex-tmp|node_modules|target|dist)(?:\/|$)/u.test(
      normalized,
    ) ||
    [...normalized].some(
      (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
    )
  )
}

export function isPublicCommitEmail(email) {
  return (
    /^(?:\d+\+)?[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\[bot\])?@users\.noreply\.github\.com$/iu.test(
      email,
    ) || email === 'noreply@github.com'
  )
}

export function inspectPrivacyText(path, text, { repositoryRoot } = {}) {
  const findings = []
  const add = (rule, offset) =>
    findings.push({ path, rule, line: text.slice(0, offset).split('\n').length })
  if (repositoryRoot) {
    const parts = repositoryRoot.replaceAll('\\', '/').replace(/\/$/u, '').split('/')
    const pattern = parts
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
      .join('[\\\\/]+')
    for (const match of text.matchAll(
      new RegExp(pattern, process.platform === 'win32' ? 'giu' : 'gu'),
    )) {
      add('local-workspace-path', match.index)
    }
  }
  for (const match of text.matchAll(
    /(?:[a-z]:[\\/]+Users[\\/]+|\/(?:Users|home)\/)([^\\/\s"'<>]{1,64})(?=[\\/\s"'<>]|$)/giu,
  )) {
    if (!exampleUsers.has(match[1].toLowerCase())) add('personal-home-path', match.index)
  }
  for (const match of text.matchAll(
    /(?<![a-z\d._%+-])[a-z\d._%+-]{1,64}@(?:[a-z\d-]{1,63}\.)+[a-z]{2,20}\b/giu,
  )) {
    const email = match[0]
    const domain = email.split('@')[1].toLowerCase()
    const suffix = domain.split('.').at(-1)
    if (
      isPublicCommitEmail(email) ||
      /(?:^|\.)example\.(?:com|org|net)$/u.test(domain) ||
      /\.(?:invalid|test|example)$/u.test(domain) ||
      imageSuffixes.has(suffix)
    )
      continue
    // Exact sentinel user names against public source hosts exercise URL validation.
    if (
      ['user', 'secret', 'pass', 'safe', 'public', 'evil'].includes(email.split('@')[0]) &&
      [
        'account.bilibili.com',
        'www.douyin.com',
        'login.douyin.com',
        'i0.hdslb.com',
        'm10.music.126.net',
        'music.163.com',
      ].includes(domain)
    )
      continue
    add('personal-email', match.index)
  }
  for (const match of text.matchAll(
    /(?<![\w.])(?:\+[1-9]\d{7,14}|(?:\+?86[- ]?)?1[3-9]\d{9})(?![\w.])/gu,
  )) {
    const linePrefix = text.slice(text.lastIndexOf('\n', match.index) + 1, match.index)
    if (/"(?:memoryBytes|jsHeapSizeLimit)"\s*:\s*$/u.test(linePrefix)) continue
    if (!examplePhones.has(match[0])) add('personal-phone', match.index)
  }
  if (publicEnvironmentFiles.has(path)) {
    for (const [index, line] of text.split('\n').entries()) {
      const value = line.trim()
      if (
        value &&
        !value.startsWith('#') &&
        !/^VITE_APP_ENV=(?:dev|prod|staging)$/u.test(value) &&
        !/^VITE_APP_DEBUG=(?:true|false)$/u.test(value)
      ) {
        findings.push({ path, line: index + 1, rule: 'public-environment-key' })
      }
    }
  }
  return findings
}

export function inspectPrivacyFile(path, bytes, options) {
  const pathFindings = inspectPrivacyText('<repository-path>', path, options)
  if (pathFindings.length) return pathFindings
  if (isPrivateDataPath(path)) return [{ path, line: 1, rule: 'private-data-file' }]
  // DER has no textual marker; detect renamed key exports before skipping binary files.
  if (bytes[0] === 0x30) {
    for (const type of ['pkcs8', 'pkcs1', 'sec1']) {
      try {
        createPrivateKey({ key: bytes, format: 'der', type })
        return [{ path, line: 1, rule: 'binary-private-key' }]
      } catch {
        // Public certificates and unrelated ASN.1 are not private keys.
      }
    }
  }
  if (bytes.subarray(0, 8192).includes(0)) {
    return /(?:^|\/)\.env(?:\.|$)/u.test(path)
      ? [{ path, line: 1, rule: 'binary-environment-file' }]
      : []
  }
  return inspectPrivacyText(path, bytes.toString('utf8'), options)
}
