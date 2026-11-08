# Vue plugin presentation

- Shared renderer adapter; consume only ui public exports and SDK DTO/schema. No workbench stores, application imports, network, credentials or external component loaders.
- Root renders bounded declarative data. `/trusted` owns build-only theme contracts, transactional switching and resource cleanup; never export trusted contracts from the public SDK.
- Themes receive controlled props/events/slots, preserve host business instances and keep host identity, login, installation, permissions and recovery surfaces fixed.
- Tests mirror src under test. Node rendering checks contracts, not real focus/layout. Follow the root no-launch rule and five verification gates.
- Complete-theme metadata/root/feature contracts belong to `@any-music/ui/theme`. `/trusted` owns injected root transactions, inert resource preparation, root error boundaries and isolated host surfaces, with no concrete-theme imports. Partial presentation contracts are unsupported. Only complete definitions enter the transaction, through one theme.root allocation; semantic feature contributions remain separate.
- Complete-root styles live in the stable ThemeHost Shadow tree; protected slots use separate host Shadow surfaces and explicit host CSS. application builds collect scoped SFC CSS as inert resource values with matching template scope IDs; no component CSS side effect supplies a Shadow surface. Media/account/native overlays and recovery are stable siblings. Capture semantic focus/scroll only inside the presentation surface; component tests do not establish browser focus or styling acceptance.

- The trusted transaction captures public `ui/theme` continuity adapters and awaits their cancellable occurrence/offset restoration after rendering. New selections, render failure and disposal revoke old restoration, including while a loader is pending. Ordinary keyed pixel/focus regions retain their existing fallback. The host owns no theme-specific row mapping, measurement cache or business state; component tests do not establish native restoration acceptance.

See [Independent Theme Development](../../docs/en/cross-platform/architecture/independent-theme-development.md) for new build-owned themes and current entry/style/allocation rules.
