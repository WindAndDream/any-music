---
documentType: architecture
runtimeScope: tauri
---

# Anonymous Plugin Networking

Chinese counterpart: [插件匿名联网](../../../zh-cn/跨平台/架构/插件联网.md). This guide owns native anonymous transport and exit constraints; actual capability admission follows [desktop delivery](plugin-system-s15-tools-and-desktop-delivery.md).

## Native authority and data combinations

am-plugin-runtime owns network_grants, exits and outbound_audit alongside identity, epoch, context and provenance. The application initializes plugins.sqlite3 schema 3 directly. NativeGate binds the real channel, selected-object context, exit kind and non-deserializable ExitPermit; plugins cannot claim identity, sensitivity or confirmation.

Acceptance progresses from L0 to an independently approved L1/network combination, then L2 declaration plus separate highest-risk approval. Decisions include the read ceiling, selected fields, historical deliveries, retained namespace and publisher/plugin lineage. Narrow hosts, removing read permission or encoding private notes as host titles cannot lower risk. Unknown offline history is L2; secrets are denied. Network grants idle for 90 days, expired grants and clock rollback fail closed. Only actual request/byte use refreshes the idle timestamp.

Each session accumulates at most 64 dispatches and 128 MiB; finished requests remain counted. At most four exits per installation and sixteen globally are active. Redirects, resource reads, Range, retries and byte delivery recheck identity, epoch, expiry and combined authorization. Revocation commits the new native epoch, cancels that installation's tokens, then acknowledges. Final host sink delivery shares the application authority barrier with revocation. Already-sent bytes cannot be recalled.

## Anonymous transport and SSRF

am-plugin-net is an independent IO crate without Tauri, runtime, accounts, vault, CDP or SQLite dependencies. Native application code injects Gate. Each hop uses a fresh cookie-free client with environment proxies, automatic retries/redirects, pooled connections, HTTP/2 coalescing and automatic decompression disabled. There is no shared/account cookie jar, Set-Cookie persistence or HttpOnly disclosure. cookieJar, source Authorization and user API keys are absent from the current SDK capability table and remain unavailable without temporary grants.

Profile 1 permits HTTPS 443, GET/HEAD/POST, URLs up to 8 KiB, total headers up to 16 KiB, POST bodies up to 1 MiB and three redirects. Ordinary API responses are limited to 4 MiB, resource reads to 64 MiB each, with a 30-second overall and 10-second connection deadline. Resources also share session budgets. Media/download channels accept GET/HEAD and bounded single ranges; POST is never automatically retried.

Rust URL parsing normalizes IDNA, case, terminal dots and default ports. Host rules are exact, without wildcards or implicit subdomains.

Versioned policy public-targets-1/2026-10-18 rejects credential URLs, control characters, unusual IPv4 notation, loopback/private/link-local/shared/documentation/test/reserved addresses, mapped IPv6, standard NAT64 and 6to4. IPv6 uses a conservative ordinary-global-unicast positive range with special subranges excluded. Every DNS A/AAAA candidate must pass before verified addresses are pinned to connections. TLS still validates the original hostname and the actual peer is checked. Every hop resolves and checks again, including final CNAME addresses.

HTTP/SOCKS/system proxy routes return Unsupported in this version, without remote DNS or a weaker fallback. Unverifiable translation/proxy topologies are outside accepted paths. Omitting credentials never substitutes for destination validation. Configuration follows the [locked-version reqwest documentation](https://docs.rs/reqwest/0.12.28/reqwest/struct.ClientBuilder.html); implementation/tests use Cargo.lock.

Address classification was checked against the [IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) and [IANA IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) special-purpose registries. This conservative rejection policy is broader than their non-globally-reachable entries; global reachability does not prove connectivity on the current network.

## Resources and other exits

Sandbox/declarative requests, images, media and downloads share Gate. Resources stores random transient ResourceRefs, URLs and native leases in memory only, with no serialization/persistence interface or placement in Track, namespace, download history or disk paths. Range, alternate and repeated reads reuse the same lease. Release, revocation and registry cleanup cancel reads. Images accept restricted raster MIME types. External URLs never enter RemoteImage, audio or the generic downloader directly through this API.

External-link and arbitrary host-write exits are denied; controlled text-result/diagnostic export uses a native save dialog and epoch recheck; HTTP, URLs and user selection cannot substitute for approval. The restricted title annotation still uses the versioned native commit with provenance and also rechecks private/network combinations at read/commit points. No generic business-write or OS-open API was added.

Generic http_request omit accepts only current random loopback grants, and anonymous register_media is denied. External packages use verified native identities and the Gate; built-in sources retain account binding.

Local outbound records contain installation, time, a SHA-256 host tag, exit kind, status class, accumulated bytes and denial flag. They omit paths, queries, headers, bodies and raw errors. Retention is bounded to 30 days/1024 records in the separate DB. No plugin log reader or telemetry is exposed. Controlled diagnostic export and verified installation use native delivery ports; they do not create generic guest exits.

## Verification boundary

Test forged subjects, L0/L1/L2 ordering, historical provenance, epoch/expiry, idle suspension, cumulative budgets, durable revocation, mixed/rebinding DNS, pinned TLS identity, proxy rejection, redirects, no Cookie replay, Range and cancellation during streaming. Test CA/connection substitution is `cfg(test)` only. Local TLS fixtures do not establish public-network or exact WebView/device acceptance.
