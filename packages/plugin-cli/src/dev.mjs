import { lstat, readFile, realpath } from 'node:fs/promises'
import { connect } from 'node:net'
import { dirname } from 'node:path'

import { hash } from '@any-music/plugin-sdk/node'
import { parseBoundedJson } from '@any-music/plugin-sdk/schema'
import { watch } from 'chokidar'

import { refuse } from './diagnostic.mjs'
import { packProject, permissionDiff } from './package.mjs'
import { snapshotProject } from './project.mjs'

/** A one-connection host-created pairing file is a local secret, never a CLI argument token.
 * The native endpoint must additionally enforce current-user ACL/peer identity and TTL. */
export async function readPairingFile(path, projectRoot) {
  if (!path)
    refuse(
      'DEV_PAIRING',
      'dev',
      'Host pairing is required.',
      'Enable DEV in an admitted host and select the project; the CLI never launches it.',
      4,
    )
  const info = await lstat(path)
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > 4096 ||
    (process.platform !== 'win32' && (info.uid !== process.getuid() || info.mode & 0o077))
  )
    refuse('DEV_PAIRING_FILE', 'pairing-file', 'Pairing file ownership or mode is invalid.')
  const value = parseBoundedJson(await readFile(path, 'utf8'))
  if (
    Object.keys(value).toSorted().join(',') !== 'endpoint,expiresAt,projectRoot,token,version' ||
    value.version !== 1 ||
    typeof value.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.token) ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= Date.now() ||
    value.expiresAt > Date.now() + 120000 ||
    (await realpath(value.projectRoot)) !== projectRoot
  )
    refuse(
      'DEV_PAIRING_BINDING',
      'pairing-file',
      'Pairing is expired or bound to a different project.',
    )
  if (process.platform === 'win32') {
    if (!/^\\\\\.\\pipe\\any-music-plugin-dev-[a-f0-9-]{36}$/.test(value.endpoint))
      refuse('DEV_ENDPOINT', 'endpoint', 'Only host named pipes are supported.')
  } else {
    const parent = await lstat(dirname(value.endpoint))
    const endpoint = await lstat(value.endpoint)
    if (
      !value.endpoint.startsWith('/') ||
      !endpoint.isSocket() ||
      endpoint.uid !== process.getuid() ||
      parent.uid !== process.getuid() ||
      parent.mode & 0o077
    )
      refuse(
        'DEV_ENDPOINT',
        'endpoint',
        'DEV socket directory must be private to the current user.',
      )
  }
  return value
}

/** Length-prefixed bounded JSON only. No arbitrary invoke, file, shell or URL messages. */
export function pairedChannel(pairing) {
  const socket = connect(pairing.endpoint)
  let pending,
    buffer = Buffer.alloc(0),
    closed = false
  const fail = () => {
    closed = true
    pending?.reject(new Error('DEV channel closed'))
    pending = undefined
  }
  socket.on('error', fail).on('close', fail)
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    if (buffer.length > 262148) {
      socket.destroy()
      return
    }
    if (buffer.length < 4) return
    const length = buffer.readUInt32BE()
    if (length > 262144) {
      socket.destroy()
      return
    }
    if (buffer.length >= length + 4) {
      try {
        const value = parseBoundedJson(buffer.subarray(4, length + 4).toString())
        buffer = buffer.subarray(length + 4)
        if (!pending || buffer.length) {
          socket.destroy()
          return
        }
        const slot = pending
        pending = undefined
        slot.resolve(value)
      } catch {
        socket.destroy()
      }
    }
  })
  return {
    async request(value) {
      if (pending || closed) throw new Error('DEV channel unavailable')
      const body = Buffer.from(JSON.stringify(value)),
        header = Buffer.alloc(4)
      if (body.length > 24 * 1024 * 1024) throw new Error('DEV snapshot budget')
      header.writeUInt32BE(body.length)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.destroy()
          reject(new Error('DEV deadline'))
        }, 305000)
        pending = {
          resolve: (result) => {
            clearTimeout(timer)
            resolve(result)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        }
        socket.write(Buffer.concat([header, body]))
      })
    },
    close() {
      socket.destroy()
    },
  }
}
export async function devProject(options, report) {
  let snapshot = await snapshotProject(options.project, options.target)
  const selectedProject = snapshot.project
  const pairing = await readPairingFile(options.pairingFile, snapshot.project.root)
  const channel = pairedChannel(pairing)
  let watcher,
    previous,
    epoch = 0,
    running = false,
    dirty = false
  try {
    const hello = await channel.request({ type: 'pair', version: 1, token: pairing.token })
    if (!hello || hello.type !== 'paired' || typeof hello.session !== 'string')
      refuse('DEV_REJECTED', 'dev', 'Host rejected pairing.', undefined, 4)
    const rebuild = async () => {
      if (running) {
        dirty = true
        return
      }
      running = true
      try {
        await selectedProject.checkRoot()
        snapshot = await snapshotProject(options.project, options.target)
        const bytes = await packProject(snapshot)
        await selectedProject.checkRoot()
        const diff = previous
          ? permissionDiff(previous, snapshot.manifest)
          : { requiresApproval: true }
        const reply = await channel.request({
          type: 'snapshot',
          session: hello.session,
          previousEpoch: epoch,
          hash: hash(bytes),
          bytes: bytes.toString('base64'),
        })
        if (
          !reply ||
          reply.type !== 'preview' ||
          reply.hash !== hash(bytes) ||
          !Number.isSafeInteger(reply.epoch) ||
          reply.epoch <= epoch
        )
          refuse('DEV_STALE', 'dev', 'Host returned an invalid snapshot identity.')
        epoch = reply.epoch
        previous = snapshot.manifest
        report({
          code: reply.activated ? 'DEV_ACTIVE' : 'DEV_PREVIEW',
          epoch,
          permissionEpoch: reply.permissionEpoch,
          hash: reply.hash,
          requiresApproval: diff.requiresApproval,
        })
      } finally {
        running = false
      }
      if (dirty) {
        dirty = false
        await rebuild()
      }
    }
    await rebuild()
    if (options.once) return { previewed: true, epoch, scope: 'dev' }
    watcher = watch(snapshot.project.root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (path) =>
        /(?:^|[\\/])(?:node_modules|\.git|dist|\.env[^\\/]*|[^\\/]*\.(?:pem|key|amplugin))(?=[\\/]|$)/i.test(
          path,
        ),
    })
    watcher.on('all', () => {
      void rebuild().catch(() => report({ code: 'DEV_BUILD_FAILED', retainedPrevious: true }))
    })
    await new Promise((resolve) => {
      const stop = () => {
        process.off('SIGINT', stop)
        process.off('SIGTERM', stop)
        resolve()
      }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
    const cancelled = new Error('DEV cancelled')
    cancelled.code = 'ABORT_ERR'
    throw cancelled
  } finally {
    await watcher?.close()
    channel.close()
  }
}
