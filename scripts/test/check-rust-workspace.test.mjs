import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

import { checkGraph, checkPureSource } from '../check-rust-workspace.mjs'

const metadata = JSON.parse(
  execFileSync('cargo', ['metadata', '--format-version', '1', '--locked'], {
    encoding: 'utf8',
    maxBuffer: 24 * 1024 * 1024,
  }),
)
test('pure protocol/policy dependency closures reject an IO dependency several edges away', () => {
  assert(checkGraph(metadata)['am-plugin-policy'].includes('am-plugin-protocol'))
  const forged = structuredClone(metadata)
  const serde = forged.packages.find((entry) => entry.name === 'serde_json')
  const network = forged.packages.find((entry) => entry.name === 'reqwest')
  forged.resolve.nodes
    .find((entry) => entry.id === serde.id)
    .deps.push({ name: 'reqwest', pkg: network.id, dep_kinds: [{ kind: null, target: null }] })
  assert.throws(() => checkGraph(forged), /forbidden transitive dependency: reqwest/)
})
test('Cargo cycle and reverse policy dependency are rejected', () => {
  const forged = structuredClone(metadata)
  const policy = forged.packages.find((entry) => entry.name === 'am-plugin-policy')
  const protocol = forged.packages.find((entry) => entry.name === 'am-plugin-protocol')
  forged.resolve.nodes
    .find((entry) => entry.id === protocol.id)
    .deps.push({ name: 'policy', pkg: policy.id, dep_kinds: [{ kind: null, target: null }] })
  assert.throws(() => checkGraph(forged), /cycle/)
})

test('anonymous plugin transport cannot acquire native authority or account persistence', () => {
  const forged = structuredClone(metadata)
  const net = forged.packages.find((entry) => entry.name === 'am-plugin-net')
  const runtime = forged.packages.find((entry) => entry.name === 'am-plugin-runtime')
  forged.resolve.nodes
    .find((entry) => entry.id === net.id)
    .deps.push({
      name: 'authority',
      pkg: runtime.id,
      dep_kinds: [{ kind: null, target: null }],
    })
  assert.throws(() => checkGraph(forged), /Forbidden anonymous transport dependency/)
})

test('standard-library IO and global clocks cannot bypass a dependency-only check', () => {
  checkPureSource('use std::collections::HashSet;', 'pure.rs')
  for (const source of [
    'use std::fs as disk;',
    'std::time::SystemTime::now()',
    'use std::{collections::HashSet, net as transport};',
  ])
    assert.throws(() => checkPureSource(source, 'bad.rs'), /IO\/clock/)
})

test('package verification cannot acquire native runtime authority or a transport', () => {
  const forged = structuredClone(metadata)
  const verifier = forged.packages.find((entry) => entry.name === 'am-plugin-package')
  const runtime = forged.packages.find((entry) => entry.name === 'am-plugin-runtime')
  forged.resolve.nodes
    .find((entry) => entry.id === verifier.id)
    .deps.push({ name: 'authority', pkg: runtime.id, dep_kinds: [{ kind: null, target: null }] })
  assert.throws(() => checkGraph(forged), /Forbidden package verifier dependency/)
})
