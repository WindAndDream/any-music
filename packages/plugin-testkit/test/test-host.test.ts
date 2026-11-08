import { describe, expect, it } from 'vitest'

import { createTestVm, runGuestTest } from '../src'

describe('production engine and guest tests', () => {
  it('executes a bundled ESM default entry and top-level await entirely inside the VM', async () => {
    const vm = await createTestVm()
    expect(
      JSON.parse(
        await vm.run(
          'await Promise.resolve(); export default async input => ({count:input.count});',
          '{"count":3}',
          undefined,
          'module',
        ),
      ),
    ).toEqual({ count: 3 })
  })
  it('releases live handles when an owner disposes a waiting VM', async () => {
    const vm = await createTestVm()
    const task = vm.run('await sleep(100); return 1;')
    vm.dispose()
    vm.dispose()
    await expect(task).rejects.toThrow()
    expect(vm.pendingCount).toBe(0)
  })

  it('uses injected time through Date and its constructor chain', async () => {
    expect(
      await runGuestTest(
        'return [Date.now(),new Date().getTime(),new Date().constructor.now()];',
        'null',
        {
          ports: { now: () => 42 },
        },
      ),
    ).toEqual([42, 42, 42])
  })

  it('retains an interrupt-count stop when deterministic time does not advance', async () => {
    await expect(
      runGuestTest('while(true){}', 'null', { ports: { now: () => 0 } }),
    ).rejects.toThrow()
  })
  it('runs async guest assertions and JSON fixtures without importing project code in Node', async () => {
    expect(
      await runGuestTest(
        'await sleep(1); return {count: input.values.length};',
        '{"values":[1,2]}',
      ),
    ).toEqual({ count: 2 })
  })

  it('does not expose host globals, business capabilities or module loaders', async () => {
    expect(
      await runGuestTest(`return ['document','fetch','WebSocket','Worker','indexedDB','localStorage',
      'BroadcastChannel','__TAURI_INTERNALS__','GM_xmlhttpRequest','require','process',
      'WebAssembly','SharedArrayBuffer'].filter(key => typeof globalThis[key] !== 'undefined');`),
    ).toEqual([])
    expect(await runGuestTest('return Object.keys(host);')).toEqual(['crypto'])
  })

  it.each([
    'eval("1+1")',
    '(0,eval)("1+1")',
    'Function("return 1")()',
    '(()=>{}).constructor("return 1")()',
    '(async()=>{}).constructor("return 1")()',
    '(function*(){}).constructor("yield 1")()',
    '(async function*(){}).constructor("yield 1")()',
    'import("https://example.com/evil.js")',
    'import("node:fs")',
  ])('rejects dynamic evaluation at the engine boundary: %s', async (expression) => {
    await expect(runGuestTest(`return await (${expression});`)).rejects.toThrow()
  })

  it('provides bounded pure standard tools through copies', async () => {
    expect(
      await runGuestTest(`const url = new URL('../a?x=hello+world','https://example.com/base/');
      return {href:url.href, query:url.searchParams.get('x'),
        text:new TextDecoder().decode(new TextEncoder().encode('中文🙂')),
        base64:atob(btoa('abc')), random:crypto.getRandomValues(new Uint8Array(8)).length,
        digest:await host.crypto.sha256('abc')};`),
    ).toEqual({
      href: 'https://example.com/a?x=hello+world',
      query: 'hello world',
      text: '中文🙂',
      base64: 'abc',
      random: 8,
      digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    })
  })

  it.each([
    'return {get value(){while(true){}}};',
    'return {toJSON(){while(true){}}};',
    'return new Proxy({}, {ownKeys(){while(true){}}});',
    'const x={}; x.x=x; return x;',
    'return {value:()=>1};',
    'return new Date();',
    'return {"__proto__":null,constructor:1};',
    'return [,,,];',
    'return "x".repeat(300000);',
    'return 1.1;',
  ])('rejects hostile DTOs and releases the realm: %s', async (source) => {
    const vm = await createTestVm({ budget: { executionMs: 20 } })
    await expect(vm.run(source)).rejects.toThrow()
    expect(vm.disposed).toBe(true)
    expect(vm.pendingCount).toBe(0)
  })

  it.each([
    'while(true){}',
    'const a=[]; while(true) a.push("x".repeat(50000));',
    'const loop=()=>Promise.resolve().then(loop); await loop();',
    'return await new Promise(()=>{});',
    'for(let i=0;i<1000;i++) sleep(10); return 1;',
  ])('terminates CPU, heap, jobs, waiting and timer floods: %s', async (source) => {
    const vm = await createTestVm({
      budget: { executionMs: 30, deadlineMs: 80, maxJobs: 128, heapBytes: 2 * 1024 * 1024 },
    })
    await expect(vm.run(source)).rejects.toThrow()
    expect(vm.disposed).toBe(true)
    expect(vm.pendingCount).toBe(0)
  })

  it('cancels an unresolved tool and drops a late resolution', async () => {
    let resolveDigest: ((value: string) => void) | undefined
    const vm = await createTestVm({
      ports: {
        sha256: () =>
          new Promise((resolve) => {
            resolveDigest = resolve
          }),
      },
    })
    const abort = new AbortController()
    const task = vm.run('return await host.crypto.sha256("abc");', 'null', abort.signal)
    await new Promise((resolve) => setTimeout(resolve, 5))
    abort.abort()
    await expect(task).rejects.toThrow('cancelled')
    resolveDigest?.('late')
    await Promise.resolve()
    expect(vm.pendingCount).toBe(0)
  })

  it('never reads malformed or executable host input', async () => {
    const vm = await createTestVm()
    await expect(vm.run('return input;', '{"a":1,"a":2}')).rejects.toThrow()
    expect(vm.disposed).toBe(true)
    vm.dispose()
    expect(await runGuestTest('globalThis.secret=1; return 1;')).toBe(1)
    expect(await runGuestTest('return typeof secret;')).toBe('undefined')
  })
})
