# Changelog

## [0.2.1] - 2026-03-07

### Fixed
- 修复 gf CLI 下载地址错误：改为从 `mirrors.tencent.com` 官方源下载
- 修复平台架构名称：x64/arm64（之前误用 amd64）

## [0.2.0] - 2026-03-07

### Changed
- **认证方式改造**：使用工蜂 CLI (`gf`) 替代手动 Private Token 配置
  - `teamai init` 自动安装 gf CLI 到 `~/.teamai/gf/`（无需 sudo）
  - 通过 `gf auth login` 交互式 OAuth 登录（支持 iOA、浏览器设备码、手动 Token）
  - 不再需要手动获取和配置 `TGIT_TOKEN`
- **Clone 方式改造**：使用 `gf repo clone` 替代 simple-git clone
  - gf clone 自动将 OAuth token 嵌入 remote URL，后续 git pull/push 无需额外认证
- **MR 创建改造**：使用 `gf mr create` 替代 TGit v3 REST API
  - reviewer 直接传 username，不再需要查询 user ID
  - 影响 `teamai push`、`teamai remove`、`teamai env add/remove`

### Removed
- 删除 `src/utils/tgit-api.ts`（TGit v3 REST API 客户端）及其测试文件
- 不再需要 `TGIT_TOKEN` 环境变量
- 移除手动 token 配置流程（`askSecret`、`openBrowser`、`saveTokenToEnvFile`）
- 移除 `resolveRepo` 预检查（`getProject`、`isRepoEmpty`、`fileExistsInRepo`）

### Added
- 新增 `src/utils/gf-cli.ts`：gf CLI 安装、认证、clone、MR 创建的完整封装
- `teamai doctor` 新增 gf CLI 安装和认证状态检查

## [0.1.14] - 2026-03-06

### Added
- 团队环境变量同步：新增 `env` 资源类型，支持从团队仓库 `env/env.yaml` 同步环境变量到成员的 shell 配置文件 (!23)
- `teamai env list` — 列出团队环境变量
- `teamai env add <key> <value>` — 添加/更新环境变量（通过 branch + MR 流程）
- `teamai env remove <key>` — 删除环境变量（通过 branch + MR 流程）
- `teamai pull` 自动将 env 变量注入 ~/.bashrc 或 ~/.zshrc，使用标记注释 `[teamai:env:start/end]` 实现幂等更新
- `teamai pull` 同时写入 `~/.teamai/env` 作为 KEY=VALUE 格式备份
- `teamai status` 显示 env 变量计数，`teamai list env` 显示变量详情
- `teamai doctor` 新增 shell profile env 注入检查项
- `teamai init` 创建 `env/` 目录，默认配置含 `env: { injectShellProfile: true }`
- 支持 `sharing.env.shellProfilePath` 自定义注入路径，`sharing.env.injectShellProfile: false` 禁用注入

## [0.1.13] - 2026-03-06

### Added
- `teamai pull` 输出详情：显示 skills/instincts 的新增/更新数量（如 `3 new, 29 updated`），hooks 显示实际条目数 (!20)
- TGit API `fileExistsInRepo` 辅助函数：检查远程仓库文件是否存在 (!18)

### Fixed
- `teamai --version` 从 `package.json` 动态读取版本号，不再硬编码（修复 0.1.12 版本号不一致问题）
- 修复 MR 创建时 `web_url` 返回 undefined 及 reviewer 未设置的问题（TGit v3 API 兼容） (!17)
- `teamai init` 对已有 teamai 仓库/已注册成员跳过多余确认提示 (!18, !19)
- `teamai init` 使用 `default_branch` 替代硬编码 `master` 检查远程文件 (!19)
- Session start hook 去掉 `--silent`，新会话启动时可见 pull 输出；`teamai init` 自动更新旧版 hook command (!20)
- `teamai pull` docs 目录只有 `.gitkeep` 时跳过同步，复制时过滤 dot 文件 (!20)

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
