---
documentType: architecture
runtimeScope: shared
---

# Error and State Model

Chinese counterpart: [错误与状态模型](../../../zh-cn/跨平台/架构/错误与状态模型.md).

## 1. Single error catalog

`packages/core/src/errors/app-error.ts` is the single source of truth for expected application errors. Every managed error has:

- a semantic `code` used by TypeScript branches, such as `not-authenticated`;
- a stable support and logging `statusCode`, such as `AM-2001`;
- a contextual user-facing `message`, falling back to the catalog default;
- catalog-derived `category`, `severity`, and `isRetryable` metadata.

Boundaries normalize caught `unknown` values with `normalizeAppError` or `toAppErrorState`. Vue state, download history, and other serializable models store `AppErrorState` and render it through `formatAppErrorMessage`. Raw platform codes, HTTP statuses, and exception objects remain in adapter-level `cause` values instead of leaking into shared layers.

## 2. Status-code allocation

| Range     | Ownership                                                                  | Existing examples                                             |
| --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `AM-1xxx` | Common input, conflict, missing data, cancellation, limits, and invariants | `AM-1001 invalid-input`, `AM-1004 not-found`                  |
| `AM-2xxx` | Authentication and authorization                                           | `AM-2001 not-authenticated`, `AM-2002 access-denied`          |
| `AM-3xxx` | Music sources, upstream responses, verification, and paging limits         | `AM-3002 upstream-error`, `AM-3005 verification-required`     |
| `AM-4xxx` | Runtime network transport                                                  | `AM-4001 network-error`, `AM-4003 request-timeout`            |
| `AM-5xxx` | Local persistence                                                          | `AM-5001 storage-read-failed`, `AM-5002 storage-write-failed` |
| `AM-6xxx` | Declarative plugin manifests                                               | `AM-6001 invalid-shape`, `AM-6006 unsupported-version`        |
| `AM-7xxx` | Media, export, and download                                                | `AM-7003 media-decode-failed`, `AM-7201 download-failed`      |
| `AM-8xxx` | Local library, material collections, and segment recipes                   | `AM-8001 collection-not-found`, `AM-8105 circular-reference`  |

Published status codes must never change meaning or be reused. Keep retired numbers reserved and allocate a new error from the next free number in its owning range. `packages/core/test/errors/app-error.test.ts` verifies format and global uniqueness.

## 3. What belongs in the catalog

The catalog covers operational errors that users or external systems can trigger and that callers need to display or branch on: expired sessions, missing resources, persistence failures, unsupported media, and input conflicts.

Build configuration errors, developer invariants, and violations of internal call contracts remain native `Error`, `TypeError`, or `RangeError` instances. They represent defects rather than recoverable business states. A boundary that must display one maps it to an appropriate `AppError` and retains the original exception as `cause`.

## 4. Success and other states

Success does not receive a "success error code." Return values and domain states already express success; an `AM-0000` would blur process lifecycle with error classification.

States are planned in three layers:

| Layer             | Rule                                                                                                                 | Current state machines                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request lifecycle | Describes one asynchronous operation with consistent lifecycle vocabulary                                            | Player `idle/resolving/ready/error`; catalog drawer `idle/restoring/ready/error`                                                                    |
| Domain state      | Keeps business meaning instead of flattening everything into one global enum; failure branches carry `AppErrorState` | Session `checking/not-required/signed-out/signed-in/expired/unavailable`; source availability `unchecked/checking/available/invalid/unavailable`    |
| Persisted outcome | Uses explicit terminal states that still explain history after reload                                                | Download batches, items, and attempts use constrained combinations of `running/queued/downloading/succeeded/failed/cancelled/interrupted/completed` |

Booleans are reserved for orthogonal properties such as `isLoading` and `isExpanded`; mutually exclusive lifecycles must not be assembled from several booleans. Failure branches carry a structured error, while normal branches clear the previous failure.

## 5. Adding an error

Separate account facts from operation failures. Login (`signed-in/signed-out/unknown`), security verification (`required/not-required/unknown`) and connectivity (`available/unavailable/unknown`) retain their latest explicit evidence independently. Challenges, timeouts, malformed responses and unknown errors do not establish logout. Missing configured or enabled accounts use `account-unavailable` (`AM-2003`), rather than a confirmed `not-authenticated` result.

Listings retain the original request's `AppErrorState` and failure location (search, import, pagination or reload; the reload operation retains its internal restore key). Verification has its own `idle/opening/waiting/confirming/restoring/failed/cancelled/complete` lifecycle; action failures never replace the original verification requirement. Expose the action only when the current listing can identify an account and perform recovery. Failure, cancellation and timeout permit retries for that same identity. Replacing the listing, deleting or disabling the account cancels old work and rejects late results. Only the initial public account ID and names enter the retained listing result; live account states, operation states and recovery closures are not persisted.

1. Confirm that an existing semantic code cannot represent the condition; message variation alone is not a new code.
2. Add a definition to the appropriate `APP_ERROR_DEFINITIONS` range with its default message, severity, and retryability.
3. Map the raw failure at the platform or feature boundary; put dynamic context in `message` and retain the original exception in `cause`.
4. Store `AppErrorState` in reactive or persisted models and derive presentation text in components.
5. Add catalog and domain-path tests. Update this document if the change also introduces a state-machine branch.

Keep `verification-required` distinct from `pagination-unavailable`: the former can expose a user-initiated source-page action and become retryable after verification, while the latter preserves already loaded results and asks the user to retry later without suggesting that verification can lift a server-side paging restriction.
