---
documentType: architecture
runtimeScope: shared
---

# Permissionless Plugin Execution

Chinese counterpart: [插件无权限执行](../../../zh-cn/跨平台/架构/插件无权限执行.md). This guide owns the current VM/Profile and resource limits. Native grants, networking and installation remain outside the VM.

## Implementation and entries

| Package                  | Current responsibility and public entries                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin-vm`              | Shared QuickJS kernel, Promise/job bridge, in-VM serialization and handle disposal; engine-free `/profile` metadata/hash, pure `/control` admission/errors, fixed `/engine.wasm` bytes                                                  |
| `plugin-sandbox-browser` | Root manages one-shot sessions, admission, an owner-side watchdog and cleanup; `/browser` creates Workers only from the fixed application resource; `/worker` handles bounded messages. Offline builds embed WASM in the trusted Worker |
| `plugin-testkit`         | Node test host using exactly the same VM, WASM, Profile, bridge and pure-tool contract. Guest tests enter as source text; Node never imports plugin/project test entries                                                                |

Production adaptation defaults to bundled single-file ESM. Its default function receives a JSON copy and returns a serializable result inside the VM. External module loading is disabled; top-level await and async results share the job budget. The `body` format supports same-VM test/contract fragments. Guest functions remain opaque QuickJS handles and never execute as host functions. The source field also has a 65,536-code-point limit within the 256 KiB message; larger entries fail explicitly. Package bytes enter through native verification and delivery; the VM grants no installation authority.

Each completed call releases its Runtime/Context, deferred promises, handles and Worker; unused sessions expire after five minutes. Persistent state is a named native capability outside the VM. Userscript assembles no external executor.

## Locked engine and Profile

MIT-licensed [quickjs-emscripten 0.31.0 pinned source](https://github.com/justjake/quickjs-emscripten/tree/235f6da2fd4f7354fa4765fde4aea880d2a4aef5), with bindings/FFI pinned to 0.31.0. `plugin-vm/scripts/build-engine.py` builds `0.31.0-am1` using Emscripten **3.1.65**:

- The engine's `JS_EvalObject` rejects guest dynamic evaluation, covering direct/indirect eval and ordinary/async/generator/async-generator constructor chains. The trusted host C compilation API remains available.
- The engine rejects dynamic import, installs no external module loader and accepts no guest bytecode. Emscripten uses `DYNAMIC_EXECUTION=0`; host eval/Function is never enabled for compatibility.
- Explicit imported memory has a **128 MiB** compiled and instance maximum. QuickJS heap is **32 MiB**, stack **256 KiB**. Both MIT licenses, original/patched source digests, build settings and artifact hashes are retained.
- WASM SHA-256: `5dadb9901b620bf9cbb6e314058e25d8cd2b2a343727f0ed0a2175bd6ade5b10`. Initialization checks actual bytes; unknown IDs/hashes fail before realm allocation. See [engine/build.json](../../../../packages/plugin-vm/engine/build.json) and the [Profile record](../../../../packages/plugin-vm/engine/profile.json).

`pnpm lint` checks engine and Profile/bridge/tool source digests; reviewed changes require explicit `node scripts/check-plugin-vm.mjs --write`. Dependency checks keep `/profile`, `/control` and adapter roots engine-free. VM/browser packages cannot import Node/Tauri or business packages; production apps cannot import testkit. The generated loader is excluded from formatting/lint and checked byte-for-byte by hash. Handwritten code uses ordinary checks.

The Profile provides pure tools only: URL/query operations, UTF-8, base64, JSON-subset structuredClone, injected-clock Date, Promise timers, bounded randomness and SHA-256/HMAC-SHA-256. No browser/Node objects cross realms. URL currently exposes a read-only parsed snapshot with an independently editable query copy. Text is UTF-8 only, with no streaming decoder; encodeInto requires enough room for the whole result. Clone accepts only the wire JSON subset. Random output is Uint8Array, at most 4096 bytes per call; HMAC keys are plugin-provided 1–4096-character strings, never host secrets. MD5, HTML, filesystem, network, storage, event subscriptions and business capabilities are absent. Console bodies are discarded. Unsupported/out-of-Profile operations fail explicitly.

## Budgets, messages and cleanup

- **1 second** cumulative VM execution excluding async waiting; **30 seconds** total deadline. Yield after at most **64 jobs**, with **10,000 jobs** total. An additional **10,000 interrupt checks** stop a stalled fake clock; counts do not imply equivalent instruction counts or CPU time across devices.
- SDK bounded JSON checks apply to inputs/outputs: **256 KiB** encoded, depth 32, 10,000 nodes, rejecting duplicate/dangerous keys and unsafe integers. Getters, toJSON, proxies and errors stay inside the interrupted VM; host code never dumps guest objects/errors. Serialization rejects accessors, custom prototypes, functions, sparse arrays and cycles.
- At most **32** pending pure tools/timers; clearing a timer does not reset its reserved budget. One root task per invocation, no implicit queues or subscriptions; concurrent calls return busy.
- Global maximum eight instances and 384 MiB reserved memory; reserving 128 MiB each admits at most **three** simultaneously. Global task cap 16, subject cap 32, **60 calls/minute per subject**, **240 globally**. Fresh request IDs and successful returns do not reset limits.
- Three crashes/budget failures in ten minutes suspend the same subject; backoff is 1/4/16 seconds. Admission retains history without deleting user data. Success, exceptions, invalid input, cancellation, deadlines, cancellation during creation, closure, idle expiry and late replies release handles, subscriptions, timers and reservations.

These are versioned conservative limits, without minimum-device/mobile calibration or a claim about whole-browser process memory. Existing budgets may only be tightened; increases require a new version and target evidence.

## Verification boundary

`pnpm check:plugin:vm` checks Profile/engine hashes and actual-engine, hostile-input, admission and Worker tests. Node Worker tests prove the built bootstrap runs in that host; they do not establish WebView CSP or native authority. Exact target admission follows [desktop delivery](plugin-system-s15-tools-and-desktop-delivery.md#evidence-and-limits). Changes to engine, bridge, Profile or budgets require reviewed hashes and matching acceptance.
