---
documentType: delivery-matrix
runtimeScope: repository
---

# Plugin Tools and Desktop Delivery

Chinese counterpart: [S15 工具与桌面交付](../../../zh-cn/跨平台/架构/插件系统重构S15工具与桌面交付.md). Progress authority: [implementation steps](plugin-system-refactoring-steps.md).

This page owns current tool/delivery contracts and exact-target admission. Implemented capabilities do not override the admission limits below.

## Tools and public boundaries

- am-plugin / @any-music/plugin-cli 0.1.0 implements create, doctor, check, test, dev, inspect, permissions diff, pack, sign, verify and migrate check. Node 24.11+, ESM, JSON stdout and redacted diagnostics. Exit codes: 0 success, 1 validation, 2 arguments, 3 environment, 4 incompatible target, 130 cancelled. --yes grants no native authority.
- Source/resource bytes are sealed inside the selected directory before a fixed Vite library build. Links, directory replacement, Node/DOM/network globals and foreign modules fail. Imports are local pure TS, erased SDK types and public /guest helpers. No project config, .env, hooks, Node tests or installation scripts run. Authors explicitly install without scripts to resolve the bootstrap lock; CI uses the resolved frozen lockfile.
- SDK root and /music stay lightweight; /schema uses generated validators; /node is Node-only verification. /guest returns named request DTOs; /host validates/dispatches public ports. GuestInvocation/GuestStep share the versioned Schema. Authorization occurs outside the VM before each fresh realm resumes with a response/checkpoint, at most 16 steps. No host function, Promise or live object enters the guest. Native commandId binds the declared command; a same-named input field cannot replace it. Command names, including music.*, cannot change operation types or downgrade selected L2 data to L1.
- Released testkit embeds the exact VM/loader/WASM/Profile and engine licenses without publishing private plugin-vm. Tests also compile into the guest. Production applications cannot depend on CLI/testkit. Kernel/Profile and host glue/resources have separate acceptance fingerprints.
- pack emits sorted, fixed-time STORE ZIP, integrity, plugin license and SBOM. sign writes a new package, sharing SDK Node Ed25519 verification. Self-signatures remain unverified publishers. migrate check supports schema-1 host copies and a side-effect-free VM smoke, not external JS migration. Permission diff is never a grant.
- SDK/CLI/testkit use the user-selected **MIT** license and retain QuickJS/binding licenses. This does not relicense the application. Packages are locally packable and not registry-published.

## Templates and capabilities

| Item               | Actual behavior                                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source-code        | A music.sources catalog in the workbench picker; bundled synthetic search by default. Optional anonymous public HTTPS JSON catalog reads, bounded to 64 KiB, through request/read/release; 20-item pages consumed on demand |
| source-declarative | Code-free schemaVersion-1 catalog, at most 100 tracks, interpreted natively and shown in the same picker                                                                                                                    |
| tag-suggestion     | Explicitly selected titles produce suggestions saved in the plugin's namespace; no direct host tag-plugin data changes                                                                                                      |
| export             | Selected-title text, native-owned result token, native save dialog and epoch recheck at write                                                                                                                               |
| Capabilities       | state.read, state.write, crypto.sha256, network.publicHttps v1; other required capabilities fail, optional ones remain unavailable                                                                                          |
| Destinations       | Catalogs enter the source picker; controlled plugin-center commands/suggestions/text. Other required extension points fail, optional points are unallocated                                                                 |

Explicit catalog query/pagination is L1. General commands with selected titles are at least L2 and cannot impersonate catalog queries. Anonymous access still requires native grants/user-linked-data confirmation, never account Cookies, proxies or renderer fetch. Iterators request one page at a time. Cancellation closes native contexts and stops VM/network work without revoking the grant; late pages are discarded. Revocation/generation replacement removes projections and old tasks. Resource handlers and the WebView2 controller are released before forced executor destruction; bounded retries reclaim profiles temporarily held by the OS. Missing media returns unavailable without historical-URL or generic-downloader fallback.

Tools are 0.1.0; wire/Profile/package/data/budget are 1, memory class minimum. Wire 1 has no predecessor; a previous major gets at least **180 days** after its successor's stable release, except security revocation. See [compatibility.json](../../../baselines/plugin-system-s15/compatibility.json). This does not promise arbitrary sources, extensions, mobile code or npm guest dependencies.

## Desktop and DEV

Native picker/drop, initial .amplugin arguments, public HTTPS URL and anymusic://plugins/install?url=... use the same immutable preview and [package transaction](plugin-packages.md). Deep links accept one credential-free public HTTPS address and never install implicitly. Independent anonymous native download applies [network-profile](plugin-networking.md) DNS pinning, per-hop redirects/environment-proxy restrictions, 16 MiB and cumulative budgets. Associations/scheme are configured; no installer was installed or system default changed. Configuration/parser/native entry evidence does not establish OS installer registration.

Manual rollback first verifies the retained package/data pair and creates a native-only preview bound to the current installation, epoch, revocation revision and deadline. A native dialog confirms the exact target version; cancellation leaves the installation unchanged. Commit consumes the preview and rechecks target policy, bindings and file integrity in the serialized transaction. Stale, expired, canceled or unadmitted requests fail without mutation. Successful rollback still disables the plugin, clears grants and advances generation/epoch; crash recovery remains independent of manual confirmation.

Main-view DEV project selection creates a Windows token-user-SID protected DACL, remote-rejecting named pipe, 120-second single-use pairing file and bounded frames. Secrets never enter arguments, URLs, events or logs. Independent plugin-dev/<uuid>/authority DB/code/data and temporary executor profiles prevent matching IDs inheriting production data/grants. Anonymous networking has no Cookie jar.

Snapshots bind plugin/session/hash/old transport epoch. Every reload requires host approval, then the normal journal install updates hash/permissionEpoch and cancels old tasks. ACK waits for an explicit transaction outcome rather than disappearance of a taken preview. End/disconnect/exit prevents late installs, revokes and cancels networking. CLI starts no app/browser by default.

`src/ipc.rs` owns the unique application command registry. Executors receive only their relay, with native window/WebView/document/session/context/deadline/sequence binding. Cross-realm budgets: 60 calls/minute/install, 240 globally, three 128 MiB VM slots, failure backoff/quarantine. At most 64 diagnostic entries include callId/plugin/hash/event/redacted outcome, excluding input/body/Cookies/pairing secrets/paths; native-dialog export stays bounded.

## Evidence and limits

- [tools.json](../../../baselines/plugin-system-s15/tools.json): real off-repository tarballs, disabled scripts and second frozen install; four templates complete check, same-VM tests, identical-byte repack, verify and copy migration. Independent host uses only public SDK/host and testkit. The same CLI performs real ACL-paired DEV install/reload, native update/paired rollback and fresh consent.
- [toolchain-sbom.json](../../../baselines/plugin-system-s15/toolchain-sbom.json): recorded tool/engine hashes, production closure and licenses. Recheck current dependencies before release.
- [desktop-dialogs.json](../../../baselines/plugin-system-s15/desktop-dialogs.json): actual native text save, diagnostic export and picker. After Windows automation focus failures, the user operated three dialogs; scripts verified contents/identity and removed exports.
- [desktop-acceptance.json](../../../baselines/plugin-system-s15/desktop-acceptance.json), [target-admission.json](../../../baselines/plugin-system-s15/target-admission.json): real UI/source search, same-VM bridge, update/rollback/revocation, DEV hash/epoch, all-command denials, same-origin independent profile storage/Cookie/cache/BroadcastChannel, guest globals, CPU, context substitution, document/Worker CSP, navigation, replay, cancellation and temporary-root reclamation.
- [checks.json](../../../baselines/plugin-system-s15/checks.json): final root/native/MSRV/security, package corpus and protocol differential. Ordinary test/build remain offline; real acceptance needs explicit --run.

Recorded admission matches Windows x86_64 / OS build 10.0.26200 / WebView2 155.0.4283.62 / Profile and fixed resource/native-host hashes. The 2026-10-21 B13-P01 budget-validation repair changes the Profile hash to `ccec9d23283bd9fcf31572499461d81371e3e42d669015c08e196c71041497b3`; the existing acceptance record retains the previous hash and does not admit this build. External installation/execution remain closed until fresh exact-target acceptance; offline regression success does not renew admission. Unknown/changed combinations cannot install/execute. Live testing found navigation callbacks alone did not stop pre-cancellation requests, so a WebView2 all-source native filter now allows only three fixed resources and exact relay transport. Guest bytes are withheld until filter installation succeeds; independent Worker CSP remains another boundary.

No claim covers arbitrary systems, complete media providers, OS installer registration or phone devices. Marketplace/publication services, provisioned distribution roots, automatic updates, SecretRef and S16 device/channel gates remain separate.
