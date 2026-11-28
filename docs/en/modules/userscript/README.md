---
documentType: documentation-index
runtimeScope: userscript
---

# Userscript runtime

[中文](../../../zh-cn/板块/用户脚本/文档索引.md)

`apps/userscript` assembles the workbench for Tampermonkey. It owns the document-start launcher, deferred Vue bootstrap, host-page integration, GM requests and one host account/proxy. Hide preserves the controller; disposing the application ends its sessions.

- [Development and runtime ports](development.md) covers GM HTTP, storage, page bridges and the dedicated opt-in real GM workflow.
- [Host isolation](host-isolation.md) covers [mount lifecycle](host-isolation.md#3-host-element-and-mount-lifecycle), [Shadow DOM styles](host-isolation.md#4-shadow-dom-style-boundaries), [input](host-isolation.md#6-events-shortcuts-and-focus), CSP and script permissions.
- [Installed GM acceptance](../../changes/acceptance/theme-userscript.md) tracks theme and input cases. [Source boards](../sources/README.md) own portable protocol details.
