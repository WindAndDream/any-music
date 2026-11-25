---
documentType: change-acceptance
runtimeScope: tauri
status: awaiting-acceptance
---

# Desktop plugin target and installer acceptance

[中文](../../../zh-cn/变更/验收/桌面插件交付.md)

**Awaiting acceptance.** The old Windows acceptance tuple belongs to its recorded OS/WebView2/Profile/resources/native-host identities. The Profile budget-validation change invalidated reuse. The native check and [current matrix](../../modules/plugins/desktop-delivery.md) govern capabilities.

| Work                              | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Renew execution/install admission | Re-run exact-target isolation, native resource filter before guest delivery, relay and permission denial, install/update/rollback/revoke/restore, command/catalog cancellation and isolated DEV. Preserve [target admission](../../../baselines/plugin-system-s15/target-admission.json), [desktop evidence](../../../baselines/plugin-system-s15/desktop-acceptance.json) and [dialog evidence](../../../baselines/plugin-system-s15/desktop-dialogs.json) at their recorded scope. |
| Verify actual OS installation     | Use the signed/selected install artifact when available. Verify file association and deep links, picker/open/save and native consent. Configured associations and direct launches leave OS registration open.                                                                                                                                                                                                                                                                        |
| Recheck tools before publication  | SDK/CLI/testkit are locally packable. The [standalone tools record](../../../baselines/plugin-system-s15/tools.json) and [SBOM](../../../baselines/plugin-system-s15/toolchain-sbom.json) support dependency and packaging comparisons. Registry publication is a [future plan](../../plans/future/external-plugin-expansion.md).                                                                                                                                                    |

Next: identify the exact candidate tuple and rerun its target suite when live inspection is requested. The [gateway checks](desktop-source-gateways.md) have a separate account and transport scope.
