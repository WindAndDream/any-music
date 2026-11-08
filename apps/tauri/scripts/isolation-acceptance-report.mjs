import assert from 'node:assert/strict'

/** Admission of S03 diagnostic evidence only; never enables production code plugins. */
export function validateIsolationAcceptance(report, expectedCommands) {
  assert.equal(report.scope, 'S03')
  assert.equal(report.status, 'passed')
  assert.equal(report.codePluginsEnabled, false)
  assert.equal(report.gracefulExit, true)
  assert.equal(report.profileCleanup.length, 1)
  assert(report.profileCleanup.every((value) => value.removed === true))
  assert.match(report.applicationSha256, /^[a-f0-9]{64}$/)
  for (const check of [
    'actualCommandDenial',
    'mainProductCommands',
    'workerWasmStartup',
    'directNetworkDenial',
    'documentCsp',
    'workerCsp',
    'originStorageIsolation',
    'cookieCacheIsolation',
    'broadcastSharedWorkerOpenerIsolation',
    'resourceNavigationDownloadDeviceDenial',
    'nativeSessionDisposal',
  ])
    assert.equal(report.checks[check], true, `Missing actual check: ${check}`)
  assert.deepEqual(report.commands, expectedCommands.toSorted())
  const versions = new Set()
  for (const label of ['main', 's03-a', 's03-b', 's03-peer']) {
    const observation = report.observations[label]
    assert.match(observation.browser.product, /^Edg\/\d+\.\d+\.\d+\.\d+$/)
    versions.add(observation.browser.product)
    if (label !== 'main') {
      assert.deepEqual(
        observation.commands.map((value) => value.command).toSorted(),
        report.commands,
      )
      assert(
        observation.commands.every(
          (value) => !value.allowed && /not allowed|explicitly denied/.test(value.error),
        ),
      )
    }
  }
  assert.equal(versions.size, 1)
  const executor = report.observations['s03-b']
  assert.equal(executor.lifecycle.unload.oldWorkerTargetsGone, true)
  assert.match(executor.lifecycle.unload.oldDocument.error, /unknown probe caller/)
  assert.equal(executor.budgets.acceptedMessages, 32)
  assert.equal(executor.budgets.acceptedSessionBytes, 65536)
  assert.equal(report.observations['s03-a'].url, report.observations['s03-peer'].url)
  assert.equal(
    new Set(
      report.nativeEvents
        .filter((value) => value.event === 'profile')
        .map((value) => value.directory),
    ).size,
    4,
  )
  assert.deepEqual(report.canaryRequests, ['/control'])
  assert(
    report.observations.main.workerCsp.fetchRejected &&
      report.observations.main.workerCsp.socketRejected,
  )
  assert(
    Object.entries(report.workerResponseHeaders).some(
      ([key, value]) =>
        key.toLowerCase() === 'content-security-policy' && value.includes("connect-src 'none'"),
    ),
  )
  return { target: 'Windows', webviewVersion: [...versions][0], codePluginsEnabled: false }
}
