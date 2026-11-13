import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { withAndroidSigning } from '../build-signed-android-release.mjs'
import { isPrivateDataPath } from '../lib/privacy.mjs'

function signingFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'any-music-signing-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return {
    directory,
    env: {
      RUNNER_TEMP: directory,
      AM_ANDROID_KEYSTORE_BASE64: Buffer.from('synthetic-keystore-fixture').toString('base64'),
      AM_ANDROID_KEY_ALIAS: 'fixture-release',
      AM_ANDROID_STORE_PASSWORD: 'synthetic-fixture-password',
      AM_ANDROID_KEY_PASSWORD: 'synthetic-fixture-password',
    },
  }
}

test('Android signing restores only a private temporary key and removes it after success or failure', (t) => {
  const { env, directory } = signingFixture(t)
  for (const fails of [false, true]) {
    let keystore
    const build = () =>
      withAndroidSigning(env, (childEnv) => {
        keystore = childEnv.AM_ANDROID_KEYSTORE
        assert.equal(dirname(dirname(keystore)), directory)
        assert.equal(readFileSync(keystore, 'utf8'), 'synthetic-keystore-fixture')
        assert.equal(childEnv.AM_ANDROID_KEYSTORE_BASE64, undefined)
        assert.equal(childEnv.AM_ANDROID_KEY_PASSWORD, env.AM_ANDROID_KEY_PASSWORD)
        if (fails) throw new Error('Fixture build failed')
        return 'built'
      })
    if (fails) assert.throws(build, /Fixture build failed/)
    else assert.equal(build(), 'built')
    assert.equal(existsSync(keystore), false)
    assert.deepEqual(readdirSync(directory), [])
  }
})

test('missing, malformed or debug signing inputs fail before executing a build', (t) => {
  const { env, directory } = signingFixture(t)
  for (const override of [
    { AM_ANDROID_STORE_PASSWORD: '' },
    { AM_ANDROID_KEYSTORE_BASE64: 'invalid!encoding' },
    { AM_ANDROID_KEYSTORE_BASE64: 'Zg' },
    { AM_ANDROID_KEY_ALIAS: 'androiddebugkey' },
    { RUNNER_TEMP: join(directory, 'checkout') },
  ]) {
    assert.throws(() =>
      withAndroidSigning(
        { ...env, ...override },
        () => assert.fail('Invalid signing inputs must not build'),
        join(directory, 'checkout'),
      ),
    )
    assert.deepEqual(readdirSync(directory), [])
  }
})

test('encoded release keystores remain private even when forced past gitignore', () => {
  for (const path of [
    'release.jks.b64',
    'keys/release.keystore.b64',
    'ANDROID_KEYSTORE_BASE64.txt',
  ])
    assert.equal(isPrivateDataPath(path), true)
})
