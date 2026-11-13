---
documentType: documentation-index
runtimeScope: shared
---

# Cross-Platform Shared Rules

Chinese counterpart: [跨平台共享规范](../../zh-cn/跨平台/文档索引.md). Runtime adapters follow [Userscript](../userscript/development.md) or [desktop](../desktop/development.md) rules.

## Architecture and workflow

- [Project Architecture](architecture/project-architecture.md)
- [Reusable Package Boundaries](architecture/reusable-package-boundaries.md)
- [Git Flow Team Policy](architecture/git-flow.md): branches, PRs, reviews, synchronization and release ownership.
- [Privacy and Secret Handling](architecture/privacy-and-secrets.md): data admission, staged/push checks and incident response.
- [Development Workflow](architecture/development-workflow.md)
- [Documentation Lifecycle](architecture/documentation-lifecycle.md)
- [GitHub Actions Builds and Releases](architecture/github-actions-release.md): product versions, desktop/Userscript builds and unsigned Android artifacts.
- [Error and State Model](architecture/error-and-state-model.md)
- [Music Source Architecture](architecture/music-source-plugin-architecture.md)
- [Product and Plugin Data Ownership](architecture/plugin-data-ownership.md)
- [Plugin Runtime Policy](architecture/plugin-runtime-policy.md)
- [Plugin Extension and Security Contracts](architecture/plugin-extension-contracts.md): allocation/extension contracts and explicitly unimplemented capabilities.
- [Independent Theme Development](architecture/independent-theme-development.md)

## Plugin execution and delivery

- [Permissionless Execution](architecture/plugin-execution.md): VM/Profile, budgets and cleanup.
- [Native Authority](architecture/native-plugin-authority.md): identities, contexts, provenance and commit/revoke.
- [Anonymous Networking](architecture/plugin-networking.md): Gate, public targets and exit budgets.
- [Packages and Recovery](architecture/plugin-packages.md): verification, signatures and paired code/data transactions.
- [Desktop Tools and Delivery](architecture/plugin-system-s15-tools-and-desktop-delivery.md): current capabilities and exact-target admission.
- [Implementation Status](architecture/plugin-system-refactoring-steps.md)

## Active plans and acceptance

- [Independent Theme Acceptance](architecture/independent-theme-ui-migration-plan.md): remaining T13 runtime/input/native cases.
- [Mobile Delivery](architecture/plugin-system-s16-mobile-delivery.md): S16 engineering, device and channel exits; mobile external execution remains `none`.
- [Refactoring Audit](architecture/refactoring-audit-plan.md): scoped audit procedure; its ledger retains unreviewed work.
- [Multi-user and Local/Cloud Deployment](architecture/multi-user-local-cloud-plan.md): unimplemented proposal.
- [Virtual Lists and Layout Performance](architecture/virtual-list-implementation-plan.md): active reuse batches, separate persistence work and remaining acceptance.

## Features and source contracts

- [Cross-Platform UI and Interaction](features/cross-platform-ui-and-interaction.md)
- [Local Library, Custom Tracks and Plugins](features/local-library-and-custom-plugins.md)
- [Resource Cache](features/resource-cache.md)
- [Feature Requirements and Roadmap](planning/feature-requirements-and-roadmap.md)
- [Bilibili Web API](platforms/bilibili/web-api-contract.md), [Douyin Web API](platforms/douyin/web-api-contract.md), [NetEase integration](platforms/netease/api-integration.md)

Website, GM and Rust transport evidence are separate. Documentation cleanup never advances source `captureDate` or target admission.
