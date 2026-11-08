# Contributing to Any Music

Read [AGENTS.md](AGENTS.md), the [documentation index](docs/en/README.md), [Git Flow](docs/en/cross-platform/architecture/git-flow.md) and [Privacy and Secret Handling](docs/en/cross-platform/architecture/privacy-and-secrets.md) before editing. Chinese guides: [文档索引](docs/zh-cn/文档索引.md)、[隐私与密钥规范](docs/zh-cn/跨平台/架构/隐私与密钥规范.md).

Use Node.js and pnpm versions pinned by `.node-version` and `package.json`. Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm privacy:setup
```

Set `git config --local user.email YOUR_GITHUB_NOREPLY_ADDRESS` to the exact noreply address from your GitHub email settings. Use a topic branch and Conventional Commits: `type: English subject` or `type(scope): English subject`, with optional kebab-case scope and `!` for breaking changes. See [commit types and examples](docs/en/cross-platform/architecture/git-flow.md#commits-and-checks). Every contributor and agent must keep real credentials, personal data and local account/browser files out of source, fixtures, documentation, metadata, screenshots, logs and artifacts. Use synthetic data and portable placeholder paths; client-visible environment variables are not secret storage.

Before committing, run `pnpm check:privacy`, `pnpm check:privacy:history`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm build`; native changes require the additional native checks in AGENTS.md. Hooks inspect staged bytes, commit identity/message and incoming push history. Do not bypass or weaken a failing check. Review images and installer contents separately because text scanners have blind spots.

Open a PR to the correct Git Flow target. Include actual validation and omitted live acceptance. Review changes to privacy rules, hooks, scanner checksums and CI independently. Do not post matched secrets in issues, reviews or CI output. The full privacy guide defines narrow exception review, incident handling and public-repository protection requirements.
