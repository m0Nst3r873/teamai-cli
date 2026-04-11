# TODOS

## ~~Cursor PostToolUse Hook Support~~ ✅ DONE
**Completed:** 2026-03-22 — Cursor hooks API 已稳定支持 postToolUse。已实现：
- `hooks.ts`: 注入 postToolUse hook (matcher: Read) 到 Cursor hooks.json
- `usage-tracker.ts`: trackFromStdin 支持 Read 工具 + SKILL.md 路径检测，tool 字段区分 cursor/claude
- 完整测试覆盖
**Added:** 2026-03-19 by /plan-eng-review

## Digest 自动推送到企微群
**What:** 将 `teamai digest` 输出通过 webhook 自动发送到企业微信群。
**Why:** 目前 digest 需要手动运行 `teamai digest`。自动推送提高团队 AI 工具使用感知，让团队成员被动接收周报而不是主动去查。
**Pros:** 零摩擦的团队 AI 使用可见性，推动 skill 采用率。
**Cons:** 需要配置企微 webhook URL，增加外部依赖。群消息过多可能被忽视。
**Context:** Feature 7 (digest) 实现后，可通过 wecom-bot skill 的 webhook 机制发送。需要在 teamai.yaml 中新增 webhook URL 配置字段。建议支持 cron 定时触发（每周一早上）。
**Effort:** M (human: ~3 days / CC: ~20min)
**Priority:** P3
**Depends on:** Feature 7 (digest) 完成。
**Added:** 2026-03-19 by /plan-ceo-review

## 增量搜索索引更新
**What:** 当文档数超过阈值时，基于 mtime 增量更新 search-index.json 而非全量重建。
**Why:** V1 全量重建简单可靠，但随着文档增长（数千篇）每次 pull 的索引重建会变慢。
**Pros:** Pull 速度不会随文档数线性增长。
**Cons:** 增量更新复杂度高（删除、重命名、损坏恢复都需要处理）。
**Context:** Eng review Issue 4 中决定 V1 先全量重建并记录耗时。search-index.ts 中应有耗时监控，当超过 2 秒时输出 warning。该 warning 触发后再考虑实现增量更新。增量方案基于文件 mtime 比对，只重建新增/修改的 doc 条目。
**Effort:** M (human: ~2 days / CC: ~30min)
**Priority:** P3
**Depends on:** Phase 2 (搜索 + 投票) 完成。
**Added:** 2026-03-19 by /plan-eng-review

## 开源前 Git History 安全审计
**What:** 在创建公开 GitHub 仓库之前，扫描 git history 中是否有泄露的 token、内网 URL（git.woa.com）、密码模式等敏感信息。
**Why:** 当前仓库托管在 TGit（内网），history 中可能包含 OAuth token 嵌入 URL、.netrc 内容引用等。一旦 push 到 GitHub 公开仓库就无法撤回。
**Pros:** 避免安全事故。开源项目的 git history 是永久公开的。
**Cons:** 如果发现敏感信息，需要 squash history 或使用 git-filter-repo 清理，会丢失 commit 历史。
**Context:** Design doc `jeff-master-design-20260327-132229.md` Open Question #3 提到了这个问题。建议在 PR2（GitHub provider + 开源准备）完成后、创建公开 repo 之前执行。用 `git log --all -p | grep -i 'token\|password\|oauth2:' | head -50` 快速扫描。如果干净则保留 history，否则 squash。
**Effort:** S (human: ~2 hours / CC: ~10min)
**Priority:** P1 — 安全相关，开源前必须完成
**Depends on:** PR2 完成。
**Added:** 2026-03-27 by /plan-eng-review

## E2E 负面场景测试
**What:** 为 E2E 测试新增 token 过期、仓库无效、网络超时等负面场景用例。
**Why:** 现有 E2E 全是 happy path，错误处理逻辑（Error Handling 表格中的 5 种场景）未被验证。
**Pros:** 确保 CI 失败时给出清晰提示（如 "TEAMAI_TEST_TOKEN expired"），而不是不明报错。
**Cons:** 需要 mock 或制造失败环境，写起来比 happy path 复杂。
**Context:** CI pipeline 设计文档 `docs/designs/ci-pipeline.md` 的 Error Handling 表列了 5 种错误场景。Eng review Issue 6 中决定先只迁移 happy path，负面测试等 CI 基础版跑通后再加。优先覆盖：(1) token 未设置/过期 (2) 无效 repo URL (3) 网络超时。
**Effort:** S (human: ~2 hours / CC: ~10min)
**Priority:** P3
**Depends on:** CI pipeline 基础版（.gitlab-ci.yml + E2E 迁移）完成。
**Added:** 2026-03-20 by /plan-eng-review

## 知识注入回路 (Phase 2 — Session Contribute 读出路径)
**What:** `teamai pull` 时将 team repo 的 `learnings/` 目录同步到本地 `~/.teamai/learnings/`，并在 CLAUDE.md 中注入提示"团队 AI 经验文档在 ~/.teamai/learnings/ 可供查阅"。
**Why:** Phase 1 完成了"写入"路径（session 经验推送到 team repo），但没有"读出"路径。没有读出，知识库只是"写了没人看的 repo"。读出是飞轮闭环的关键——其他人的 AI 工具在遇到类似场景时可以引用这些知识。
**Pros:** 完成"写入→读出"闭环。AI 工具自动获取团队经验。团队智能飞轮开始转动。
**Cons:** 需要修改 pull.ts 和资源处理器，中等复杂度。learnings 数量增长后需要考虑同步性能。
**Context:** Phase 1 (session contribute) 在 `learnings/<title-slug>-<date>-<random>.md` 格式存储。读出需要：(1) pull.ts 新增 learnings 类型同步 (2) CLAUDE.md 注入提示 (3) 未来进阶：基于工作目录和任务类型智能推荐相关文档。
**Effort:** M (human: ~3d / CC: ~25min)
**Priority:** P1
**Depends on:** Phase 1 (session contribute 功能) 完成。
**Added:** 2026-03-27 by /plan-ceo-review

## 自动检测项目类型推荐标签 (Tag Filtering V2)
**What:** `teamai pull` 时扫描当前工作目录，根据 package.json → typescript、go.mod → golang、Cargo.toml → rust 等文件特征，自动建议订阅相关标签。
**Why:** V1 tag filtering 需要用户手动运行 `teamai tags subscribe`，新用户不知道订阅什么标签。自动检测能减少 onboarding 摩擦，让标签系统开箱即用。
**Pros:** 零配置体验。新用户 pull 时自动获得与项目相关的 skill 子集。
**Cons:** 检测逻辑需要维护（新语言/框架需要新增规则）。可能误判（多语言项目）。
**Context:** V1 tag filtering 在 v0.10.0 实现，基于 team-repo/tags.yaml 集中管理 + ~/.teamai/config.yaml subscribedTags。V2 只需在 pull 入口检测 cwd 文件特征，生成建议标签列表，首次提示用户确认。实现位置：pull.ts 或新建 auto-detect.ts。
**Effort:** M (human: ~3d / CC: ~20min)
**Priority:** P2
**Depends on:** V1 tag filtering 完成（已完成）。
**Added:** 2026-04-01 by /plan-eng-review

## isToolInstalled 的 split('/')[0] 路径假设
**What:** `ResourceHandler.isToolInstalled()` 用 `toolPath.split('/')[0]` 提取工具根目录（如 `.claude/skills` → `.claude`），假设所有 toolPath 都是 `.<tool>/<type>` 两级格式。
**Why:** 如果未来新增的工具配置为多级路径（如 `.config/claude/skills`），`split('/')[0]` 会返回 `.config`，导致检查错误地认为工具已安装（`.config/` 可能因为其他原因存在）。
**Pros:** 修复后 isToolInstalled 能正确处理任意深度的 toolPath。
**Cons:** 当前所有 7 个工具都是 `.<tool>/<type>` 格式，此问题暂不存在。提前修复是过度工程。
**Context:** 由 outside voice (Claude subagent) 在 eng review 中发现。当前 `base.ts:68` 的实现。如果要修复，可以改为查找 toolPath 中第一个以 `.` 开头的路径段，或者在 teamai.yaml 中显式声明 toolRoot。建议等到真正引入非标准路径格式时再处理。
**Effort:** S (human: ~1h / CC: ~5min)
**Priority:** P4
**Depends on:** 无。
**Added:** 2026-04-11 by /plan-eng-review
