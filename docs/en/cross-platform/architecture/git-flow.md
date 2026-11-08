---
documentType: development-guide
runtimeScope: repository
---

# Git Flow Team Policy V1.0

Chinese counterpart: [Git Flow 团队规范](../../../zh-cn/跨平台/架构/GitFlow团队规范.md). Applies to every contributor, agent and runtime. `develop` is the integration branch; `dev` is not a branch alias. The default branch remains `main`.

## Branches and ownership

| Branch                     | Start from                   | PR target                                           | Purpose and owner                                                          |
| -------------------------- | ---------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| `main`                     | Existing release history     | —                                                   | Long-lived accepted release history; release maintainer                    |
| `develop`                  | Existing integration history | —                                                   | Long-lived development integration; maintainer                             |
| `feature/<issue-or-topic>` | Latest `origin/develop`      | `develop`                                           | One feature or independently reviewable refactor; assigned author          |
| `fix/<issue-or-topic>`     | Latest `origin/develop`      | `develop`                                           | Ordinary bug fix; assigned author                                          |
| `release/<version>`        | Latest `origin/develop`      | `main`, then `develop`                              | Version preparation, regression and release-only fixes; release maintainer |
| `hotfix/<issue-or-topic>`  | Latest `origin/main`         | `main`, then `develop` and active release if needed | Urgent released-product repair; incident owner                             |

Use lowercase ASCII words separated by hyphens; issue IDs are encouraged, for example `feature/42-virtual-lists`. One owner coordinates shared branches. Each contributor uses a separate checkout/worktree. Keep unrelated work on separate branches; do not share dirty worktrees or commit someone else's unfinished files without authorization.

No direct commits/pushes, force pushes or unauthorized deletion on `main`/`develop`. Treat published topic history as shared: update with merges, never rebase or force-push it. An unpublished personal branch may be rebased before its first push. Never use `reset --hard`, `clean -fd` or branch deletion to resolve a teammate's work.

## Daily development and integration

```sh
git fetch origin --prune
git switch -c feature/42-virtual-lists origin/develop
# Edit, run target checks, then the root gates below.
git add <explicit-related-paths>
git diff --cached
git commit -m "feat(music-workbench): add virtual collection browsing"
git push -u origin feature/42-virtual-lists
# Open a PR with base develop.
```

Before review, fetch and merge `origin/develop` into the topic branch when needed. Resolve conflicts on the topic branch and ask the affected owner to review semantic conflicts. Verify both sides' behavior, especially storage formats, cancellation and runtime isolation. Preserve the original commits and authors when synchronizing another contributor's branch. Do not cherry-pick an entire divergent history or use an “ours” merge to silence conflicts.

All PRs use **Create a merge commit**. Squash/rebase merging is disabled by policy so release, hotfix and back-merge ancestry remains auditable and responsibility-based commits survive. Linear-history protection must remain off. Normal merges have at least one approval from a reviewer other than the author, passing CI for the current head/merge result, and resolved conversations. New commits invalidate the previous approval. Release/hotfix approval must include a maintainer and a tester's recorded acceptance; a reviewer may also be that tester. Agents cannot approve their own work or substitute local tests for human acceptance.

PR titles follow the commit format. Include problem/result, runtime scope, commit batches, executed commands/results, omitted live/device acceptance, risks and related issues. Use the repository PR template. Required checks must run on docs-only PRs too; do not use path filters that leave protected checks pending. The CI policy validates routes and non-merge commit messages; reviewers verify branch ancestry, freeze scope and acceptance.

## Commits and checks

New commits and PR titles follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `type: imperative subject` or `type(scope): imperative subject`. Use an English ASCII header of at most 100 characters with no final period. The optional scope identifies the affected package, runtime or subsystem in kebab-case, for example `music-workbench`, `tauri`, `userscript`, `player` or `release`. Omit it for changes spanning the repository. Preserve identifier casing such as IPC and AppErrorState in the subject.

`commitlint.config.js` extends `@commitlint/config-conventional` and defines the repository overrides. Use its standard types:

| Type       | Purpose                                                 |
| ---------- | ------------------------------------------------------- |
| `feat`     | Add a feature                                           |
| `fix`      | Repair a bug                                            |
| `docs`     | Change documentation                                    |
| `style`    | Change formatting without changing behavior             |
| `refactor` | Restructure code without adding features or fixing bugs |
| `perf`     | Improve performance                                     |
| `test`     | Add or update tests                                     |
| `build`    | Change build tooling or dependencies                    |
| `ci`       | Change CI workflows                                     |
| `chore`    | Perform other maintenance                               |
| `revert`   | Revert a previous change                                |

Choose the type by the result of the change; `dev` is not a commit type. Mark a breaking change with `!` immediately before the colon, a `BREAKING CHANGE:` footer, or both. Explain the incompatible contract and migration in the description/body/footer. For example:

```text
feat(music-workbench): add virtual collection browsing
fix(tauri): cancel stale media requests
docs: clarify contribution checks
refactor(core)!: require stable source identities

BREAKING CHANGE: callers must supply source IDs when creating tracks.
```

Separate an optional body and footer from the preceding section with a blank line. Use the body for the reason and migration details, and footers such as `Closes #42` for issue references. Wrap body/footer prose at 100 characters. Apply the new format to new work without rewriting existing history. Git-generated merge messages retain commitlint's default handling; PR titles and non-merge commits must use the conventional format. Give Chinese explanations in the task handoff without creating local commit-note files.

One commit owns one coherent change and its tests. Keep dependent public contracts/consumers together; split independent fixes, tooling and documentation. Inspect staged paths and exclude credentials, generated installers, caches and local logs. Stage explicit paths instead of blindly staging a mixed workspace. Every commit should remain buildable. A final verification applies to an unchanged batch sequence; rerun affected checks when resolving conflicts or modifying code.

Before committing, run from the repository root with the pinned pnpm and locked dependencies:

```sh
pnpm privacy:setup
pnpm check:privacy
pnpm check:privacy:history
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Native changes additionally require `pnpm check:native`, `pnpm check:rust:msrv` and `pnpm check:rust:deny`. Follow [Development Workflow](development-workflow.md#verification-results) for reporting results and runtime-specific checks. CI runs these checks on Windows. Release builds cover the declared target matrix separately; neither a Windows pass nor another developer's macOS pass proves a different commit/device. Record commit, OS/architecture, toolchain, commands and remaining limits with external acceptance. Live UI/browser/emulator checks still require explicit task authorization.

`pnpm install --frozen-lockfile` installs Husky. `pre-commit` rejects long-lived/detached branches, staged whitespace errors, private identities and staged data; `commit-msg` validates and scans messages; `pre-push` rejects direct protected-branch updates/deletion, shared-history rewrites and tag moves/deletion. It requires annotated tags on fetched `origin/main` history. Hooks are convenience checks, not server security or proof of full validation. The same pre-push stream also checks incoming commit privacy and secrets; see [Privacy and Secret Handling](privacy-and-secrets.md). Run all root gates before committing and pushing; do not disable hooks to bypass policy.

## Releases, hotfixes and synchronization

1. Appoint a release maintainer and tester. Create `release/<version>` from the chosen `origin/develop` commit and record scope. Freeze features; allow only version/changelog/build/regression fixes. For a release-only fix, create `fix/<version>-<topic>` from that release branch and PR back to it; this is the explicit exception to the ordinary fix base. Keep new features on `develop`.
2. Run `pnpm release:prepare <version> <android-version-code>`, review all synchronized manifests and commit with `chore(release): prepare release <version>`. Use SemVer: major for breaking product contracts, minor for backward-compatible features, patch for fixes; prereleases use `-beta.N`/`-rc.N`. The unreleased product stays in `0.x` until explicitly accepted for `1.0`. Never invent a release merely to synchronize development.
3. Run CI, build-only release matrix and the agreed runtime/device acceptance. Open `release/* -> main`; approval must name the exact commit and acceptance limits. Only release-related fixes can enter the candidate. Any candidate change requires applicable revalidation and renewed approval.
4. After the approved PR merges, fetch `origin/main` and create an annotated `vVERSION` on its release merge commit. The version must match every product manifest. Push only that tag. Release CI rejects tags outside `origin/main` history and verifies commit, versions and artifact hashes. The release maintainer reviews the resulting manifest and Release before deployment. Deploy only accepted artifacts from that tag; never rebuild from a moving branch for production. See [Builds and Releases](github-actions-release.md).
5. PR `main -> develop` to preserve the final release merge and all release fixes. A direct `release/* -> develop` back-merge is allowed after its commits have entered `main`, but still synchronize the final `main` history. Recheck any conflicts. Do not delete the release branch until both destinations contain it.
6. For urgent released-product issues, create `hotfix/*` from `origin/main`, repair and validate through PR to `main`, then publish the next appropriate version through the same tag/Release process. No emergency exemption permits direct protected pushes, unreviewed merging or skipped CI. PR `main -> develop`; synchronize the active release via a `main` or `hotfix/*` PR when affected. Keep the branch until all required destinations contain the fix.

To create a release tag after approval (substitute the accepted version):

```sh
git fetch origin --tags
git tag -a v0.2.0 origin/main -m "Release 0.2.0"
git push origin v0.2.0
```

Delete completed `feature/*`/`fix/*` only after merge and confirmation with the owner. For release/hotfix branches, confirm both `main` and `develop`, plus any affected active release. Check `git merge-base --is-ancestor <branch-head> origin/<destination>` for every required destination. Then delete the remote branch and use `git branch -d` locally after switching away. Do not enable unconditional auto-deletion on PR merge: release/hotfix synchronization may still be pending. Never delete published version tags; publish a corrected version rather than moving one.

## Repository settings and enforcement limits

Configure branch protection/rulesets for `main` and `develop` with: PR-only changes, at least one independent approval, stale approval dismissal, last-push approval, resolved conversations, up-to-date branches, required `Privacy and secrets`, `Git Flow policy` and `Repository checks (Windows x64)`, no force pushes/deletion and no administrator bypass. Require `Release candidate checks` additionally on `main`; it does not run on PRs targeting `develop` or `release/*`. Add equivalent release-freeze protection for `release/*` when supported. Keep merge commits enabled and squash/rebase merging off. Restrict creation of `v*` tags to release maintainers and prohibit tag updates/deletion. Configure the signing and final-publication environments in [Builds and Releases](github-actions-release.md#configure-github-before-accepting-contributions). Do not enable linear history or automatic topic deletion. Grant write access only to contributors who need it and admin access only to maintainers; do not name unconfirmed people in CODEOWNERS.

**Verify enforcement on the actual repository.** The original private repository last returned HTTP 403 for branch protection and rulesets on 2026-11-07, so server enforcement was not active. Keep that repository private when preparing a separate public snapshot without old personal history. Configure and verify the rules above on the new repository before accepting contributions; public visibility, checked-in CI and local hooks do not automatically activate them. Recheck after repository, plan or visibility changes. Until settings are verified, maintainers enforce policy operationally and must not describe branches as technically protected.

Official references: [Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [Ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [Git branching workflows](https://git-scm.com/book/en/v2/Git-Branching-Branching-Workflows), [Semantic Versioning](https://semver.org/).
