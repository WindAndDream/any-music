#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { ProtocolValidationError } from '@any-music/plugin-sdk/schema'
import { Command, CommanderError } from 'commander'

import { testProject } from './build.mjs'
import { Diagnostic, refuse } from './diagnostic.mjs'
import {
  checkMigration,
  inspectPackage,
  packProject,
  permissionDiff,
  readPackage,
  signPackage,
} from './package.mjs'
import { COMPATIBILITY, snapshotProject, TOOL_VERSION } from './project.mjs'
import { createProject } from './templates.mjs'

const projectOptions = (command) =>
  command
    .option('--project <directory>', 'Selected project', '.')
    .option('--target <target>', 'Compatibility target', 'desktop')

export async function main(args = process.argv.slice(2), io = process) {
  let result
  const program = new Command()
    .name('am-plugin')
    .version(TOOL_VERSION)
    .exitOverride()
    .option('--json', 'Stable JSON output')
    .option('--no-color')
    .option('--yes', 'Local actions only')
    .configureOutput({ writeOut: (value) => io.stdout.write(value), writeErr: () => {} })
  const project = projectOptions
  program
    .command('create <destination>')
    .requiredOption('--template <name>')
    .action(async (destination, options) => {
      result = await createProject(destination, options.template)
    })
  project(program.command('doctor')).action(async (options) => {
    const [major, minor] = process.versions.node.split('.').map(Number)
    const runtime = major > 24 || (major === 24 && minor >= 11)
    const lock = await readFile(resolve(options.project, 'pnpm-lock.yaml'), 'utf8').catch(() => '')
    result = {
      compatibility: COMPATIBILITY,
      nodeCompatible: runtime,
      lockfile: lock ? (lock.includes('integrity:') ? 'resolved' : 'bootstrap') : 'missing',
      target: options.target,
      productionAdmission: false,
    }
    if (!runtime)
      refuse(
        'NODE_VERSION',
        'node',
        'Node 24.11 or later is required.',
        'Use the supported Node release.',
        3,
      )
  })
  project(program.command('check')).action(async (options) => {
    const snapshot = await snapshotProject(options.project, options.target)
    result = {
      valid: true,
      id: snapshot.manifest.id,
      target: options.target,
      productionAdmission: false,
    }
  })
  project(program.command('test').option('--profile <profile>', 'VM target', 'desktop')).action(
    async (options) => {
      if (options.profile !== 'desktop')
        refuse(
          'PROFILE',
          'profile',
          'Only the locked desktop VM is admitted for tests.',
          undefined,
          4,
        )
      result = await testProject(await snapshotProject(options.project, options.target))
    },
  )
  project(program.command('pack').option('--reproducible').option('--output <file>')).action(
    async (options) => {
      const snapshot = await snapshotProject(options.project, options.target)
      const bytes = await packProject(snapshot)
      const output =
        options.output ??
        resolve(
          options.project,
          snapshot.manifest.id + '-' + snapshot.manifest.version + '.amplugin',
        )
      await writeFile(output, bytes, { flag: 'wx' })
      result = {
        ...inspectPackage(await readPackage(output)),
        output: output.split(/[\\/]/).at(-1),
        reproducible: true,
      }
    },
  )
  for (const name of ['inspect', 'verify'])
    program
      .command(name + ' <file>')
      .option('--target <target>')
      .option('--trusted-fingerprint <sha256>')
      .action(async (file, options) => {
        const value = await readPackage(file, options.target)
        if (options.trustedFingerprint && value.signer !== options.trustedFingerprint)
          refuse(
            'PUBLISHER',
            'signature',
            'Publisher does not match the explicitly trusted fingerprint.',
          )
        result = {
          ...inspectPackage(value),
          publisherVerified: Boolean(options.trustedFingerprint),
        }
      })
  program
    .command('permissions')
    .command('diff <old> <next>')
    .action(async (old, next) => {
      result = permissionDiff((await readPackage(old)).manifest, (await readPackage(next)).manifest)
    })
  program
    .command('sign <file>')
    .requiredOption('--key <file>')
    .requiredOption('--output <file>')
    .action(async (file, options) => {
      result = await signPackage(file, options.key, options.output)
    })
  program
    .command('migrate')
    .command('check')
    .requiredOption('--from <fixture>')
    .requiredOption('--to <package>')
    .action(async (options) => {
      result = await checkMigration(options.from, await readPackage(options.to))
    })
  project(program.command('dev').option('--pairing-file <file>').option('--once')).action(
    async (options) => {
      const { devProject } = await import('./dev.mjs')
      result = await devProject(options, (value) => io.stderr.write(JSON.stringify(value) + '\n'))
    },
  )
  try {
    await program.parseAsync(args, { from: 'user' })
    if (result !== undefined) io.stdout.write(JSON.stringify({ ok: true, result }) + '\n')
    return 0
  } catch (error) {
    if (
      error instanceof CommanderError &&
      ['commander.helpDisplayed', 'commander.version'].includes(error.code)
    )
      return 0
    const exitCode =
      error instanceof Diagnostic
        ? error.exitCode
        : error instanceof CommanderError
          ? 2
          : error?.code === 'ABORT_ERR'
            ? 130
            : error instanceof ProtocolValidationError ||
                error?.name === 'VmError' ||
                [
                  'Archive',
                  'Integrity',
                  'Manifest',
                  'Signature',
                  'Resource',
                  'Budget',
                  'Path',
                  'Unsupported',
                ].includes(error?.message)
              ? 1
              : 3
    const diagnostic =
      error instanceof Diagnostic
        ? error.diagnostic
        : {
            code: error instanceof CommanderError ? 'ARGUMENTS' : 'TOOL_FAILURE',
            path: '',
            message:
              error instanceof CommanderError
                ? 'Invalid command arguments.'
                : 'Operation failed; no authorization was granted.',
            suggestion: 'Review project inputs, permissions and tool compatibility.',
          }
    io.stdout.write(JSON.stringify({ ok: false, diagnostics: [diagnostic] }) + '\n')
    return exitCode
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
)
  process.exitCode = await main()
