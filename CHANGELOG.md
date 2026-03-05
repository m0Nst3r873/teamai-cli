# Changelog

## [0.1.11] - 2026-03-05

### Added
- CodeBuddy IDE 支持：hooks/skills/rules 同步覆盖 CodeBuddy 工具目录 (!15)
- 分支 + MR 工作流：`teamai push` 改为创建独立分支并自动创建 Merge Request，支持 reviewer 审批 (!14)
- Tombstone 机制：已删除的资源不会被 `teamai push` 重新推送 (!12)

### Changed
- 简化成员管理：移除 readonly/write 角色系统，所有成员统一权限 (!13)

## [0.1.9] - 2026-03-05

### Added
- `teamai remove <type> <name>` 命令：从团队仓库和本地删除 skills/rules 资源 (!10)
- Cursor hooks 支持：`teamai init` 自动注入 `.cursor/hooks.json` 格式的 SessionStart hook (!9)

### Fixed
- 文档与代码对齐 (!11)

## [0.1.7] - 2026-03-05

### Added
- `teamai push` 支持推送 rules 到团队仓库 (!6)
- 成员角色管理：支持 readonly/write 角色区分 (!5)
- `teamai init --repo` 支持短格式 `owner/repo` (!1)

### Changed
- Rules 分发改为独立文件同步到各工具 rules 目录，不再内联到 CLAUDE.md (!7)

### Fixed
- `teamai init` 自动配置 git user (!4)
- TGIT_TOKEN 获取链接更新为 `/profile/account` (!2)

## [0.1.0] - 2026-03-03

### Added
- 初始发布
- `teamai init` — 初始化团队仓库关联、注册成员、注入 SessionStart hooks
- `teamai push` — 推送本地 skills 到团队仓库
- `teamai pull` — 拉取团队资源（skills、rules、hooks、docs）到本地 AI 工具目录
- `teamai sync` — 双向同步（push + pull）
- `teamai status` — 查看本地与团队仓库的差异
- `teamai list` — 列出团队资源
- `teamai members` — 列出团队成员
- `teamai doctor` — 诊断配置问题
- 支持 Claude Code、Codex、Claude Code Internal、Cursor 四种 AI 工具
- SessionStart hook 自动拉取团队最新内容
