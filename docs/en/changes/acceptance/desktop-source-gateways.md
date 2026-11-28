---
documentType: change-acceptance
runtimeScope: tauri
status: awaiting-acceptance
---

# Desktop declarative source gateway acceptance

[中文](../../../zh-cn/变更/验收/桌面来源认证.md)

**Awaiting acceptance.** The [native gateway](../../modules/tauri/source-authentication.md) has implementation and offline coverage for QR, credential and SMS flows, explicit no-login policy and account-bound pagination.

Next, test an admitted target with a user-approved gateway when live inspection is requested. Cover consent, one complete auth flow per supported mode, no-login, expiry/retry, account switch during a listing, cancellation and late pages, and credential removal/revocation. Record the exact runtime and gateway protocol, actual behaviors and remaining modes without retaining tokens or account state. Keep [exact target admission](desktop-plugin-delivery.md) separate.
