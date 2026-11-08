# Plugin Testkit

- Node test host for the exact production `plugin-vm`, engine bytes and Profile. Never import/evaluate a plugin or its tests in Node; pass bundled source text into QuickJS.
- Test-only pure tools, deterministic fixtures and fault injection may be provided here. Production apps/renderers/runtime packages must not depend on testkit; the Node author CLI may consume it. The test host grants no real business/network/storage capability.
- Ship local tarballs embedding the exact private VM/engine with no published private runtime dependency. Keep its fixed build and installed type/runtime acceptance in sync. Registry publication has not occurred; the recorded Windows acceptance does not admit changed Profile/resource combinations. This suite does not certify a new WebView, OS, channel or production authorization boundary; see the [matrix](../../docs/en/cross-platform/architecture/plugin-system-s15-tools-and-desktop-delivery.md).
