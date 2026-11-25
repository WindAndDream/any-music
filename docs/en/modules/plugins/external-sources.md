---
documentType: module-contract
runtimeScope: tauri
---

# External source settings and package previews

[中文](../../../zh-cn/板块/插件/外置音乐源设置.md)

Settings exposes the native entry points under the build-owned feature. The [desktop matrix](desktop-delivery.md) governs operations on each target.

## 6. Runtime Settings

Tauri registers `feature.external-sources` as the optional built-in “外置音乐源” plugin. Its switch in the plugin center uses the existing module preferences and safe-start recovery. When enabled and a native package port exists, Settings → Music Sources exposes “外置音乐源” with public HTTPS package-address and local `.amplugin` file imports, plus native previews, consent and installed-package management. Files are limited to 16 MiB; addresses must return a standard package, and source packages declare `music.sources`. Native validation and target admission still decide which operations are available; Android's port remains preview-only.

Disabling the feature removes that settings entry and the “外置音乐源” group in source management, unmounts visited import forms, discards transient previews and cancels pending commands/catalog pages. Installed packages, grants and product records remain stored; re-enabling registers the current native catalog snapshot without replaying queries. Userscript has no external-source module or import entry because its external policy remains `none`.
