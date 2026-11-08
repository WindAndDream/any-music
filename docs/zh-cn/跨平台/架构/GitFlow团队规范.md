---
documentType: development-guide
runtimeScope: repository
---

# Git Flow 团队规范 V1.0

英文对应页：[Git Flow Team Policy](../../../en/cross-platform/architecture/git-flow.md)。适用于所有开发者、代理和运行端。集成分支统一称为 `develop`，`dev` 不是别名；默认分支仍为 `main`。

## 分支与职责

| 分支                   | 起点                  | PR 目标                                            | 用途与负责人                               |
| ---------------------- | --------------------- | -------------------------------------------------- | ------------------------------------------ |
| `main`                 | 现有发布历史          | —                                                  | 长期维护已验收的发布历史；发布维护者负责   |
| `develop`              | 现有集成历史          | —                                                  | 长期维护开发集成；维护者负责               |
| `feature/<任务或主题>` | 最新 `origin/develop` | `develop`                                          | 单项功能或可独立评审的重构；指定开发者负责 |
| `fix/<任务或主题>`     | 最新 `origin/develop` | `develop`                                          | 普通问题修复；指定开发者负责               |
| `release/<版本>`       | 最新 `origin/develop` | `main`，随后同步 `develop`                         | 版本准备、回归和发版修复；发布维护者负责   |
| `hotfix/<任务或主题>`  | 最新 `origin/main`    | `main`，随后同步 `develop`，必要时同步当前 release | 已发布产品的紧急修复；问题负责人负责       |

分支后缀使用小写 ASCII 单词和连字符，建议包含任务编号，例如 `feature/42-virtual-lists`。共享分支指定一位协调人。各成员使用独立检出目录或 worktree，不共用有未提交改动的工作区；未经授权不得提交他人尚未完成的文件。不相关任务放在不同分支。

禁止在 `main` / `develop` 直接提交、直接推送、强制推送或擅自删除。已推送的任务分支视为共享历史，通过 merge 更新，不再 rebase 或强推。尚未首次推送的个人分支可以 rebase。不得用 `reset --hard`、`clean -fd` 或删除分支处理他人工作。

## 日常开发与评审

```sh
git fetch origin --prune
git switch -c feature/42-virtual-lists origin/develop
# 修改、目标校验，再执行下文的完整根检查。
git add <相关文件的明确路径>
git diff --cached
git commit -m "feat(music-workbench): add virtual collection browsing"
git push -u origin feature/42-virtual-lists
# 创建目标为 develop 的 PR。
```

评审前按需将最新 `origin/develop` 合并到任务分支，在任务分支解决冲突。语义冲突由对应模块负责人复核，验证双方行为，尤其是存储格式、取消流程和运行端隔离。同步他人分支时保留原始提交和作者，不将整段分叉历史逐个 cherry-pick，也不使用 “ours” 合并掩盖冲突。

所有 PR 使用 **Create a merge commit**。规范禁止 squash/rebase 合并，以保留分批提交以及 release、hotfix、回合并的祖先关系；不得同时要求线性历史。合并至少需要一位非作者审核通过、当前提交/合并结果的 CI 通过、所有评审讨论解决。新增提交使原审核失效。Release/Hotfix 还需维护者审批和测试者对明确提交的验收记录，审核者可兼任测试者；代理不得自审或用本地测试替代人工验收。

PR 标题沿用提交格式，正文使用仓库模板，说明问题与结果、运行端范围、提交批次、实际执行命令与结果、缺失的实机验收、风险和关联任务。纯文档 PR 也运行必要检查，不用路径过滤造成保护检查永久等待。CI 检查分支流向和非 merge 提交格式；分支起点、冻结范围与验收真实性仍由评审确认。

## 提交与验证

新提交和 PR 标题遵循 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)：`type: imperative subject` 或 `type(scope): imperative subject`。标题使用英文 ASCII，最多 100 字符，不以句号结尾。可选的 scope 用小写连字符格式标识受影响的包、运行端或子系统，例如 `music-workbench`、`tauri`、`userscript`、`player`、`release`；跨仓库变更可以省略。描述使用祈使语气，保留 IPC、AppErrorState 等标识符的大小写。

`commitlint.config.js` 继承 `@commitlint/config-conventional`，并定义仓库附加规则。使用其标准类型：

| 类型       | 用途                           |
| ---------- | ------------------------------ |
| `feat`     | 新增功能                       |
| `fix`      | 修复问题                       |
| `docs`     | 修改文档                       |
| `style`    | 调整格式，不改变行为           |
| `refactor` | 重构代码，不新增功能或修复问题 |
| `perf`     | 优化性能                       |
| `test`     | 新增或调整测试                 |
| `build`    | 修改构建工具或依赖             |
| `ci`       | 修改 CI 流程                   |
| `chore`    | 其他维护工作                   |
| `revert`   | 撤销先前变更                   |

根据变更结果选择类型，`dev` 不作为提交类型。破坏性变更在冒号前加 `!`，或添加 `BREAKING CHANGE:` 尾注，也可以同时使用；在描述、正文或尾注中说明不兼容契约及迁移方式。例如：

```text
feat(music-workbench): add virtual collection browsing
fix(tauri): cancel stale media requests
docs: clarify contribution checks
refactor(core)!: require stable source identities

BREAKING CHANGE: callers must supply source IDs when creating tracks.
```

可选正文、尾注与前一部分之间空一行；正文解释原因和迁移细节，关联任务可以使用 `Closes #42` 等尾注。正文和尾注文字按每行 100 字符换行。新规范用于后续工作，不重写已有历史。Git 自动生成的合并说明保留 commitlint 默认处理；PR 标题和非 merge 提交必须使用上述格式。中文说明直接写在任务交接中，不创建本地提交说明文件。

一个提交对应一项完整职责及其测试。公共契约和依赖它的消费者必须放在同一可构建批次；独立修复、工具和文档分别提交。检查暂存内容，排除凭证、安装包、缓存和本地日志，混合工作区应明确选择路径。每个提交应可构建。完整验证可覆盖此后内容不变的提交序列；解决冲突或修改实现后重跑相关校验。

提交前，在仓库根目录使用固定 pnpm 和锁定依赖执行：

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

原生变更还需 `pnpm check:native`、`pnpm check:rust:msrv`、`pnpm check:rust:deny`。结果说明与运行端专属检查遵循[开发工作流](开发工作流.md#验证结果)。CI 在 Windows 上执行这些检查；跨平台发布矩阵单独构建。Windows 通过或他人某次 macOS 通过不代表不同提交、不同设备也通过。外部验收必须记录提交、系统/架构、工具链、命令和限制。启动浏览器、产品或模拟器仍需当前任务明确授权。

`pnpm install --frozen-lockfile` 安装 Husky。`pre-commit` 拦截长期分支／游离提交、暂存空白错误、个人邮箱身份和暂存隐私数据；`commit-msg` 检查格式并扫描说明；`pre-push` 拦截长期分支直接更新/删除、共享历史改写以及 Tag 修改/删除，并要求发布 Tag 为已获取的 `origin/main` 历史上的附注 Tag。同一份推送更新流也检查新增提交隐私与秘密，详见[隐私与密钥规范](隐私与密钥规范.md)。钩子是便捷检查，不是服务端安全边界或完整验证证明。提交及推送前必须执行完整检查，不得关闭钩子绕过规范。

## Release、Hotfix 与同步

1. 指定发布维护者和测试者，从选定的 `origin/develop` 提交创建 `release/<版本>`，记录范围并冻结功能，只接受版本、变更说明、构建和回归修复。仅影响该版本的修复从对应 release 创建 `fix/<版本>-<主题>` 并 PR 回该 release，这是普通 fix 起点规则的明确例外。新功能继续进入 `develop`。
2. 执行 `pnpm release:prepare <版本> <Android版本号>`，检查所有同步清单，以 `chore(release): prepare release <version>` 提交。使用语义化版本：不兼容产品契约升 major，兼容功能升 minor，修复升 patch；预发布采用 `-beta.N` / `-rc.N`。尚未正式发布的产品维持 `0.x`，明确验收后再进入 `1.0`，不得为同步开发内容而擅自发版。
3. 完成 CI、不发布的完整构建矩阵及约定的运行端/设备验收，创建 `release/* -> main` PR；审批必须指明提交及验收限制。候选版本变动后重新执行相关验证并重新审核。
4. PR 合并后获取 `origin/main`，在发布 merge 提交上创建附注 `vVERSION`，版本须匹配所有产品清单。仅推送该 Tag；Release CI 拒绝不属于 `origin/main` 历史的 Tag，并核对提交、版本和产物哈希。发布维护者检查最终清单与 Release 后才部署，正式部署只使用该 Tag 已验收的构建产物，不从可移动分支重新构建。参见[构建与发布](GitHubActions构建与发布.md)。
5. 创建 `main -> develop` PR，保留最终发布 merge 和全部修复。Release 提交已进入 `main` 后也可先直接 PR `release/* -> develop`，但仍需同步最终 `main` 历史，冲突重新校验。两个目标都包含该分支前不删除 release。
6. 已发布产品的紧急问题从 `origin/main` 创建 `hotfix/*`，修复、验证并 PR 到 `main`，按同样流程发布合适的新版本。紧急情况不豁免 PR、审核和 CI。再 PR `main -> develop`，受影响的当前 release 通过 `main` 或 `hotfix/*` 的 PR 同步，所有必要目标完成前保留分支。

审批后创建发布 Tag 的示例（替换为实际验收版本）：

```sh
git fetch origin --tags
git tag -a v0.2.0 origin/main -m "Release 0.2.0"
git push origin v0.2.0
```

Feature/Fix 合并且负责人确认后才能删除；Release/Hotfix 还须确认 `main`、`develop` 及受影响的当前 release 已同步。对每个必要目标执行 `git merge-base --is-ancestor <分支头> origin/<目标分支>`，再删除远端分支，切换离开后用 `git branch -d` 删除本地分支。不要开启 PR 合并后无条件自动删除：release/hotfix 可能仍需同步。已发布版本 Tag 永不移动或删除，应发布修正版。

## 仓库设置与实际限制

为 `main` / `develop` 配置分支保护或 Rulesets：只接受 PR、至少一位独立审核者、丢弃过期审核、要求最后一次推送获批、解决全部讨论、保持分支最新、要求 `Privacy and secrets`、`Git Flow policy` 和 `Repository checks (Windows x64)`、禁止强推和删除、管理员不可绕过。仅 `main` 额外要求 `Release candidate checks`，它不覆盖目标为 `develop` 或 `release/*` 的 PR。条件允许时为 `release/*` 配置同等冻结保护。只允许 merge commit，关闭 squash/rebase 合并；限制 `v*` Tag 由发布维护者创建并禁止修改/删除。按[构建与发布](GitHubActions构建与发布.md#接受贡献前配置-github)配置签名与最终发布环境。不开启线性历史或自动删除任务分支。按需授予 write，admin 仅限维护者；未确认人员分工前不虚构 CODEOWNERS。

**须核验实际仓库的强制效果。**原私有仓库在 2026-11-07 的分支保护与 Rulesets 接口仍返回 HTTP 403，服务端保护尚未启用。准备不带旧个人历史的独立公开快照时，原仓库保持私有。在接收贡献前，为新仓库配置并核验上述规则；公开可见性、已提交的 CI 和本地钩子不会自动启用保护。仓库、套餐或可见性变更后重新核对。在核验完成前，由维护者执行团队约定，不能将分支描述为已受技术保护。

官方参考：[分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)、[Rulesets 可用范围](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)、[Git 分支工作流](https://git-scm.com/book/en/v2/Git-Branching-Branching-Workflows)、[语义化版本](https://semver.org/lang/zh-CN/)。
