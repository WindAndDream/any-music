---
documentType: architecture
runtimeScope: shared
---

# Development Workflow and Agent Guidance

Scope: shared TypeScript/Vue and repository workflows. File naming, SFC and composable conventions do not apply to Rust. Runtime data access follows [userscript](../../userscript/development.md) or [desktop](../../desktop/development.md) rules.

Chinese counterpart: [开发工作流](../../../zh-cn/跨平台/架构/开发工作流.md). This page holds task-specific naming, Vue, build and guidance maintenance details. Root `AGENTS.md` keeps durable boundaries and completion checks.

## Naming and ownership

- Use kebab-case for source directories, ordinary TypeScript and styles; meaningful multi-word PascalCase for Vue SFCs. Root `App.vue`, index/main/vite-env files, configs and Sass `_partial.scss` retain tool conventions.
- Component imports and template tags match the PascalCase filename. Match disk casing exactly; on Windows use two `git mv` operations through a temporary name for casing-only renames.
- Use camelCase for variables, parameters, fields and functions, PascalCase for types/interfaces/classes, and UPPER_SNAKE_CASE only for immutable shared module constants. Write acronyms as Api/Http/Url/Id/Html/Css/Ms; preserve external protocol names and environment variables.
- Prefer is/has/can/should for booleans; existing control semantics such as loading/disabled are valid props. Pluralize collections and use Count/Index/Ms/Bytes for quantities and units.
- Name functions with verbs, native handlers handleXxx and event forwarding forwardXxx. Reuse existing Track, source/plugin and catalog vocabulary. Public renames update types, exports, tests and docs together.
- Match `use-xxx.ts` to `useXxx`; keep pure calculations/parsing/formatting as ordinary functions. Colocate types with their module and export public APIs through package entry points or explicit subpaths.
- Put tests in each owner's root `test/`, mirroring `src/`, with the tested module's name plus `.test.ts`. Shared component tests belong to UI; runtime composition tests belong to applications. Keep test doubles inside the test package without introducing production dependencies for fixtures.
- Keep upstream snake_case DTOs in plugin-source-* packages and runtime bridges; map to project camelCase before core, features or UI. SDK wire fields retain their versioned Schema names at the trusted adapter boundary.

## Vue collaboration and migration

- Order SFC blocks as `<script setup lang="ts">`, `<template>`, optional `<style scoped>`. Export shared resets/tokens/Shadow styles separately. Use kebab-case or consistent BEM classes and `--am-*` variables.
- Type props, emits, slots and defineModel explicitly. Use camelCase in TypeScript and kebab-case for template props/events/named v-model. Treat props as readonly, request mutations through events/models, and keep computed values pure.
- Roots and feature containers compose dependencies. Extract requests, persistence, timers, subscriptions, media sessions, cancellation/retry/race flows, cross-view state and independently tested logic into feature/UI composables. Composition of three or more independent state sources also warrants extraction; line count alone does not.
- Focus, hover, animation and measured dimensions may remain local when purely presentational. Extract state that changes business results or persists across views. Share headless contracts between runtime applications instead of copying component internals.
- Use options objects for multiple dependencies and Ref/getter/MaybeRefOrGetter reactive inputs with toValue inside reactive contexts. Return refs/computed and named actions in a plain object; controlled internal state is readonly except explicit drafts/two-way inputs.
- Create composables synchronously in setup or an active scope. Dispose listeners, timers, requests, Object URLs, media and encoding tasks. Abort or ignore stale results with generation tokens and remove failed promises immediately.
- Lock props, emits, wording, DOM semantics and user results before refactoring, then cover composables and black-box component behavior. Node rendering only proves executable interaction contracts; real focus/layout/device behavior requires explicitly authorized runtime checks.

## Builds and dependencies

- Keep pnpm workspace, catalog and recursive scripts; internal dependencies use `workspace:*`. Before adding libraries assess native/CSS alternatives, browser ESM, maintenance, license, tests, tree-shaking and measured bundle growth.
- Name deployable applications `@any-music/<app>` with build:dev/staging/prod; application build defaults to prod.
- Use `build:<app>` for a production build and `build:<app>:dev` or `build:<app>:staging` for other modes. Root `build`, `build:dev` and `build:staging` recursively build eligible packages in their respective modes.
- Do not add empty future-runtime directories or forwarding packages. Require a stable reused responsibility for new packages. Evaluate orchestration tools only for measured CI bottlenecks, affected graphs/remote caching or multi-team task ownership.
- Bundle userscript dependencies by default. External @require needs a pinned version, size measurements and documented offline/cache behavior. Mobile pruning needs a real entry point and output inspection.

## Privacy before publication

Follow [Privacy and Secret Handling](privacy-and-secrets.md) and [Contributing](../../../../CONTRIBUTING.md). Install the pinned scanner with `pnpm privacy:setup`, use GitHub noreply commit identities, and run `pnpm check:privacy` plus `pnpm check:privacy:history` before the root gates. Keep real account data out of fixtures, evidence, screenshots, logs and artifacts; use `<user-home>` / `<project-root>` in durable records. Existing sanitized evidence retains its original measurement dates and hashes and does not establish a new acceptance run.

## Verification results

Run development commands with output in the terminal, inspect their results and exit codes, and report outcomes and remaining limits directly in the task handoff. Do not create local command/test/build logs, per-task log directories or per-commit note files unless explicitly requested. This applies to shared, Userscript and Tauri development; installed application diagnostics retain their runtime-owned behavior.

When a result needs durable repository evidence, retain a concise record with the command, outcome, runtime/build scope and necessary hashes or references, following the [documentation lifecycle](documentation-lifecycle.md). Existing referenced evidence keeps its recorded path; check references and preserve unique evidence before moving or removing old files. Existing local logs and personal notes remain Git-ignored.

## Documentation languages

For selective reading, authoritative ownership, task closure, retention/deletion and a reusable agent prompt, follow [Documentation Lifecycle and Agent Instructions](documentation-lifecycle.md).

Choose language by audience and purpose, keeping one primary language per file. This is a repository maintenance convention, not a claim that English is inherently better for models.

| Content                                                  | Primary language    | Preserve verbatim                                                                 |
| -------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| README.md and docs/zh-cn                                 | Chinese             | Package/API/field/path/command names, standards and product names                 |
| README.en.md and docs/en                                 | English             | Chinese counterpart titles, actual UI wording, search terms and source quotations |
| AGENTS.md, repository SKILL.md and skill references      | English             | Identifiers and exact UI/source text; prefer English project documentation links  |
| Public SDK/CLI/testkit READMEs and protocol explanations | English             | Public exports, protocol fields, commands and raw test vectors                    |
| User-facing explanations and delivery                    | The user's language | Explicit language preferences and literal product wording                         |

Chinese prose uses localized terms for renderer, namespace, loader, journal and provenance. Preserve exact identifiers such as `namespaces`, `permissionEpoch`, `InstallFiles` and `AppErrorState` in inline code. Proper names and common abbreviations such as Profile, QuickJS, Tauri, GM, IPC and DTO remain English; explain ambiguous first uses in the surrounding language.

Chinese counterpart titles, real button labels and search terms are intentional quotations in English docs; retain them and add an English gloss when useful. Translation never renames files, exports, storage keys or protocol enums, and never changes historical facts, authorization conditions or `captureDate`. Keep facts/scope synchronized across locales without duplicating whole translated paragraphs in one body. Documentation language does not change the language used with the user.

## Maintaining AGENTS.md and skills

Official documentation reviewed on **2026-10-01**. This organization is a repository choice based on official guidance, not an OpenAI-mandated template, language or line limit.

- Root AGENTS.md holds durable goals, directory routing, critical constraints and completion checks; package guides hold local differences. Link maintained task-specific documents instead of copying manuals.
- Codex builds its instruction chain at startup from global scope and the repository root down to the working directory. Each directory selects override, AGENTS or configured fallback in that order; the default combined cap is 32 KiB. Starting at the root does not load all descendant guides, so explicitly read the target package guide. Deduplicate instead of merely increasing the cap.
- Keep repository skills at `.agents/skills/<name>/SKILL.md`, with required name/description frontmatter and precise capability/trigger wording. Scope each skill to one recognizable workflow, put conditional detail in references, and add scripts only for useful deterministic or repeated work.
- Load only references required for the task and respect explicit user directions, existing authorization and root verification policy. Capture skills do not authorize live inspection during ordinary edits; do not advance captureDate without a real recapture.
- agents/openai.yaml is optional appearance/dependency metadata; do not create empty files for formality. Keep shared, runtime-specific and website-capture skills implicitly selectable by default; descriptions distinguish GM from IPC/Rust and load only relevant runtime guidance and leave personal/installed generic skills untouched.
- Check frontmatter, links, current ownership and representative positive/negative trigger requests. Static checks do not prove actual model selection; distinguish them from executed agent evals.

- After each refactoring batch, update obsolete ownership, dependencies, storage and admission statements in maintained guides directly, including both locales and indexes. Do not leave contradictions behind a final “supersedes earlier text” paragraph. Implementation steps own current progress, delivery matrices own actual capabilities, and stage records preserve evidence and limits at that stage.

Official sources: [AGENTS.md discovery and layering](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Codex best practices](https://learn.chatgpt.com/guides/best-practices#make-guidance-reusable-with-agentsmd), [Build skills](https://learn.chatgpt.com/docs/build-skills).

## Validation and Git batches

Follow [Git Flow Team Policy](git-flow.md) for topic branches, PR routes, independent review, merge commits and release/tag ownership. Complete root gates before committing; local hooks do not replace them.

Complete the five root checks and review the diff before responsibility-based commits. Leave formatting enforcement to formatter/lint rather than repeating it as review rules. Keep interdependent migrations in one buildable batch; separate independent interaction changes and guidance.

`commitlint.config.js` enforces Conventional Commits with English headers, such as `docs: refresh agent guidance` or `fix(tauri): cancel stale media requests`; see [commit types and examples](git-flow.md#commits-and-checks). Give Chinese explanations in the task handoff. Commits do not require a local note file or a post-commit logging hook.

Do not launch products, development servers, browsers, emulators or UI automation without an explicit runtime inspection request. Update platform recapture dates only after real capture; report omitted live/device checks in the handoff.
