---
documentType: architecture
runtimeScope: tauri
---

# Music Source Authentication

Chinese counterpart: [音乐源认证](../../zh-cn/桌面端/音乐源认证.md).

Authentication methods, permission to use a source without login, and an account's current login state are separate contracts. Desktop Bilibili, Douyin and NetEase accounts require successful native verification before appearing in the account list. Bilibili and Douyin offer native QR and system-browser verification where supported; NetEase offers QR login only. Douyin's existing secondary SMS verification remains a challenge within its official login flow; it is not an invented primary phone-login API.

External declarative API sources declare their own QR, credential-input and SMS phone methods. System-browser authentication is reserved for built-ins and is rejected in external manifests. `allowUnauthenticated` controls the explicit **No login required** choice; it is never inferred from a failed login. Static catalogs and ordinary sandbox catalogs retain their existing account-free behavior.

## Package declaration

The CLI `source-gateway` template creates a declarative source. Edit its public `plugin.json` metadata and package it normally; `manifest.json` inside the final `.amplugin` preserves `sourceAuthentication`. Never put a real token, password or phone number in package files.

```json
{
  "sourceAuthentication": {
    "protocolVersion": 1,
    "apiBaseUrl": "https://api.example.com/music/",
    "allowUnauthenticated": false,
    "methods": ["qr", "credentials", "phone"],
    "credentialFields": [
      {
        "id": "token",
        "label": { "en": "API token", "zh-CN": "API Token" },
        "secret": true
      }
    ]
  }
}
```

The complete manifest also requires `execution: declarative`, its own `music.sources` contribution, the `search` command, and required version-1 `source.authentication` and `network.publicHttps` capabilities. Credential fields are bounded, uniquely named and required when submitted. Declare fields only when `credentials` is offered. For a source that exclusively permits use without login, use `allowUnauthenticated: true`, `methods: []`, and `credentialFields: []`.

Version 1 accepts HTTPS on port 443, a lowercase host, and a trailing slash with plain alphanumeric/underscore/hyphen path segments. User information, query strings, fragments, redirects, private destinations and proxies are unavailable. The host displays the authentication service address before input. Schema and native package validation reject malformed or unsupported declarations.

## Gateway protocol 1

The interface developer adapts their existing API behind these fixed endpoints, relative to `apiBaseUrl`. This is a versioned adapter protocol, not permission for a guest to supply arbitrary authentication scripts, URLs or browser operations. Send and receive JSON through POST. Authentication failures return HTTP 401; other failures must not contain user-visible secret diagnostics.

| Endpoint            | Request                                          | Successful response                                                                               |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `auth/qr/start`     | `{}`                                             | `{"status":"waiting","challengeId":"opaque","qrContent":"text to encode","expiresInSeconds":120}` |
| `auth/qr/poll`      | `{"challengeId":"opaque"}`                       | `waiting`, `scanned`, `expired`, or the signed-in response below                                  |
| `auth/credentials`  | `{"fields":{"token":"user input"}}`              | signed-in response                                                                                |
| `auth/phone/send`   | `{"phone":"+8613800000000"}`                     | `{"status":"code-sent","challengeId":"opaque","retryAfterSeconds":60}`                            |
| `auth/phone/verify` | `{"challengeId":"opaque","code":"123456"}`       | signed-in response                                                                                |
| `auth/session`      | `{}`, with native-owned Bearer authorization     | `{"status":"signed-in","userId":"stable-service-identity"}`                                       |
| `search`            | `{"query":"music","pageNumber":1,"pageSize":20}` | SDK `WireTrackPage`, with this manifest's `source.pluginId`                                       |

For example, `waiting` means `{"status":"waiting"}`. A signed-in response is `{"status":"signed-in","userId":"stable-service-identity","token":"opaque-session-token"}`. The identity must be a nonempty stable string of at most 128 bytes; the token is at most 8192 printable ASCII bytes. QR content is encoded locally; remote QR images never load. QR lifetime is 5–600 seconds. Polls are serial and at least two seconds apart. SMS codes contain 4–10 ASCII digits; resends have a native account-scoped 60–300 second cooldown, including failed sends and login cancellation/reselection. Credentials and verification codes are transient inputs; only the verified session token is saved.

Search is one bounded request per consumer page, at most 50 pages, with a 64 KiB response limit and a 15-second transport deadline. Its account identity, including an explicit no-login selection, is fixed for the listing. Deleting or disabling that account cancels its requests and prevents later pages from silently selecting another identity. HTTP 401 expires the account; connection failures preserve login evidence. Explicit account checks use `auth/session`.

## Native ownership and lifetime

`apps/tauri/src-tauri/src/plugins/source_auth` owns verified configuration, challenges, token storage and the host-only gateway transport. SDK Schema owns declaration shape; generic plugin VM networking remains anonymous. Built-in CookieStores, proxies and system-browser processes are never lent to this path. `am-plugin-net` remains an anonymous transport crate; the host gateway reuses its public-target/DNS policy and the native Gate's identity, epoch, budgets and delivery barriers.

Tokens are encrypted in the native vault and bound to installation identity, publisher and authentication configuration. Public snapshots, product backups and guest state do not contain them. A form captures the displayed configuration's native fingerprint. Native submission rechecks it before dispatch, so an update cannot redirect already-entered credentials to a replacement service. Changing authentication configuration requires fresh login. Selected public source queries use the L1 consent boundary; host notes remain L2 and Secret host data remains unavailable. Plugin installation still requires native confirmation, including user-linked networking consent.

New accounts begin as hidden login drafts. Only a verified identity/token commit, or an explicitly permitted no-login choice, publishes the account. Closing an unfinished form cancels its exact login generation and discards the draft; a late close cannot delete a completed account. Restart cleans abandoned drafts when their owned files are available. Duplicate source identities are rejected before credential writes.

Deletion first revokes work and disables the account, then waits for the owned browser process tree. Cancelled Douyin work terminates its owned tree without the graceful-close delay. Vault deletion and Profile detachment run on a blocking worker; a validated same-volume rename moves the Profile to a non-account tombstone directory. The account transaction can then finish without traversing its cache files. A single background collector retries tombstones, including after restart. Failed detachment leaves the account disabled and the error visible for retry; history and existing music remain available.

## Delivery and verification

This implementation has offline Schema/package, native authority/vault and renderer lifecycle tests. It does not renew [S15 target admission](../cross-platform/architecture/plugin-system-s15-tools-and-desktop-delivery.md), establish live service compatibility, or add external media resolution. Existing exact target/resource/Profile checks remain authoritative. Gateway authentication is unavailable in isolated DEV sessions; use a verified, explicitly installed package on an admitted desktop target. Mobile external policy remains `none`, and Userscript does not install external packages.
