---
documentType: future-plan
runtimeScope: repository
status: proposed
---

# External plugin expansion

[中文](../../../zh-cn/计划/未来/外置插件扩展.md)

**Proposed.** See [desktop delivery](../../modules/plugins/desktop-delivery.md) for what can run on admitted targets. Userscript and mobile policies remain in their [runtime matrix](../../modules/plugins/runtime-policy.md).

- **Media and resources**. Introduce a trusted adapter only when a source needs it. Resolve on demand, expose bounded handles and preserve descriptor → native → Range/MSE → complete fallback. Bind bytes, redirects, Range, artwork and downloads to installation/context, budgets, epoch and revocation. Never pass arbitrary guest URLs to the WebView.
- **Additional contributions**. Define version, trust, cardinality, effects, cleanup and fallback for each real consumer. Candidate areas include bounded declarative navigation/views, track or list actions, and settings. Protected UI and build-owned themes keep their host trust boundary.
- **Distribution**. Publisher roots, registry publication, a marketplace and optional update UX need an independent delivery and recovery contract using the native installer and consent.
- **Service-bound permissions**. SecretRef, private targets, private-data egress and cross-plugin services need separately versioned permissions, explicit user decisions and revocation checks. [Optional service proposal](optional-services.md).

Choose a concrete first extension with its acceptance target. Keep public contracts and actual SDK/native capability lists synchronized.
