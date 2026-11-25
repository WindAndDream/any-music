# Contributing to Any Music

Read [AGENTS.md](AGENTS.md), the [documentation index](docs/en/README.md), [Git Flow](docs/en/guides/git-flow.md) and [Privacy and Secret Handling](docs/en/guides/privacy-and-secrets.md) before editing. Chinese guides: [文档索引](docs/zh-cn/文档索引.md)、[隐私与密钥规范](docs/zh-cn/开发指南/隐私与密钥规范.md).

Before editing code or configuration, create a short step record in the [change workflow](docs/en/guides/documentation-workflow.md). Scale the steps and verification to the size of the change.

Use Node.js and pnpm versions pinned by `.node-version` and `package.json`. Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm privacy:setup
```

Git author/committer emails may be personal or GitHub noreply addresses; use `git config --local user.email YOUR_GITHUB_NOREPLY_ADDRESS` if you prefer to keep yours private. Use a topic branch and Conventional Commits: `type: English subject` or `type(scope): English subject`, with optional kebab-case scope and `!` for breaking changes. See [commit types and examples](docs/en/guides/git-flow.md#commits-and-checks). Every contributor and agent must keep real credentials, personal data and local account/browser files out of source, fixtures, documentation, commit messages, screenshots, logs and artifacts. Personal email addresses are permitted only in Git author/committer metadata. Use synthetic data and portable placeholder paths; client-visible environment variables are not secret storage.

Before committing, run `pnpm check:privacy`, `pnpm check:privacy:history`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm build`; native changes require the additional native checks in AGENTS.md. Hooks inspect staged bytes, commit messages and incoming push history. Do not bypass or weaken a failing check. Review images and installer contents separately because text scanners have blind spots.

Open a PR to the correct Git Flow target. Include actual validation and omitted live acceptance. Review changes to privacy rules, hooks, scanner checksums and CI independently. Do not post matched secrets in issues, reviews or CI output. The full privacy guide defines narrow exception review, incident handling and public-repository protection requirements.
