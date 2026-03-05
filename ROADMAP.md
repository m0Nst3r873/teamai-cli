# Team AI Roadmap

> 灵感来源：[Superpowers](https://github.com/obra/superpowers) (agentic skills 框架) 和 [OpenSpec](https://github.com/Fission-AI/OpenSpec) (spec-driven 开发框架)。
>
> Team AI 的核心差异化在于**团队协作与资源分发**——不生产 skills，而是解决"一个人写了好用的 skill，怎么让团队都用上"。以下功能围绕这一核心持续增强。

---

## P0 — 基础能力补全

### 1. Skill 元数据标准化 (front-matter)

**来源：** Superpowers 的 SKILL.md 结构化元数据

**现状：** 当前只检查 `SKILL.md` 是否存在，不解析任何元数据。无法支持搜索、过滤、版本比较。

**方案：** 在 `SKILL.md` 头部引入 front-matter：

```yaml
---
name: test-driven-development
author: jeffyxu
version: 1.0.0
tags: [testing, workflow]
trigger: auto | manual | slash-command
description: 强制 TDD RED-GREEN-REFACTOR 流程
---
```

**改动范围：**
- `src/resources/skills.ts` — push/pull 时解析 front-matter（已有 `gray-matter` 依赖）
- `src/status.ts` — 基于 version 字段显示版本变化
- `src/types.ts` — 新增 `SkillMeta` 类型定义

**验收标准：**
- [ ] push 时自动读取并校验 front-matter
- [ ] `teamai list skills` 显示 name / author / version / tags
- [ ] 缺少 front-matter 的 skill 仍兼容，显示为 "unversioned"

---

### 2. 内容级变更检测 (content hash)

**来源：** Superpowers 的版本追踪 + OpenSpec 的状态管理

**现状：** `status` 命令只比较资源名称，`modified` 永远为空数组。pull 时无条件覆盖，用户不知道什么被改了。

**方案：**
- pull 时为每个资源计算 SHA-256 hash，记录到 `state.json`
- 下次 pull 时对比 hash，检测实际内容变更
- `teamai status` 显示 added / modified / removed 三类真实 diff

**改动范围：**
- `src/utils/fs.ts` — 新增 `hashFile()` / `hashDir()` 工具函数
- `src/resources/base.ts` — `diff()` 方法增加内容级比较
- `state.json` schema — 新增 `resourceHashes: Record<string, string>`

**验收标准：**
- [ ] `teamai status` 能正确显示被修改的资源
- [ ] pull 后 state.json 记录所有资源的 hash
- [ ] 首次使用时自动建立 hash 基线

---

## P1 — 体验提升

### 3. 资源脚手架 (`teamai create`)

**来源：** OpenSpec 的 `/opsx:propose` 自动生成结构化模板

**现状：** 创建 skill/rule 完全手动，无标准模板，导致格式不统一。

**方案：** 新增 `teamai create` 子命令：

```bash
teamai create skill <name>    # 生成 skills/<name>/SKILL.md 模板
teamai create rule <name>     # 生成 rules/<name>.md 模板
```

**改动范围：**
- `src/create.ts` — 新命令模块
- `src/index.ts` — 注册命令
- 内置模板字符串（无需外部模板文件）

**验收标准：**
- [ ] 生成的 SKILL.md 包含完整 front-matter 模板和内容提示
- [ ] 目标已存在时提示而非覆盖
- [ ] `--local` 选项生成到本地 AI 工具目录，默认生成到团队 repo

---

### 4. 选择性同步

**来源：** 两个项目都支持细粒度操作

**现状：** pull 全量同步所有资源类型，无法跳过或选择。

**方案：**

```bash
teamai pull --only skills,rules   # 只拉取指定类型
teamai pull --skip hooks          # 跳过指定类型
teamai pull skill <name>          # 拉取单个资源
```

**改动范围：**
- `src/pull.ts` — 增加 `--only` / `--skip` 过滤逻辑
- `src/resources/base.ts` — `pullOne()` 方法支持单资源拉取
- `src/index.ts` — CLI 参数注册

**验收标准：**
- [ ] `--only` 和 `--skip` 互斥，同时使用时报错
- [ ] 单资源拉取时精确匹配名称
- [ ] `--silent` 模式下仍遵循过滤规则

---

### 5. 资源格式校验 (`teamai validate`)

**来源：** Superpowers 的 skill 质量保障方法论

**现状：** push 前不做格式检查，团队 repo 中可能存在不规范的资源。

**方案：**

```bash
teamai validate                  # 校验团队 repo 中所有资源
teamai validate skill <name>     # 校验单个 skill
teamai push --validate           # push 前自动校验（默认开启）
```

校验规则：
- Skill: SKILL.md 存在、front-matter 格式正确、必填字段完整
- Rule: .md 文件非空、无语法错误
- Hooks: YAML 语法正确、hooks 结构符合 schema

**改动范围：**
- `src/validate.ts` — 新模块
- `src/push.ts` — push 前调用 validate
- `src/index.ts` — 注册命令

**验收标准：**
- [ ] 校验失败时输出具体错误位置和修复建议
- [ ] `--no-validate` 可跳过校验
- [ ] 退出码非零，便于 CI 集成

---

## P2 — 规模化支撑

### 6. 分类体系与标签搜索

**来源：** Superpowers 按 testing / debugging / collaboration 分类 skills

**现状：** 资源扁平存放，数量多了之后难以发现和筛选。

**方案：**
- 基于 front-matter `tags` 字段实现虚拟分类（不改变目录结构）
- 新增搜索命令：

```bash
teamai search "tdd"                    # 全文搜索
teamai list skills --tag testing       # 按标签过滤
teamai list skills --author jeffyxu    # 按作者过滤
```

**改动范围：**
- `src/status.ts` — `list` 命令增加 `--tag` / `--author` 过滤
- `src/search.ts` — 新增全文搜索模块

**验收标准：**
- [ ] 搜索覆盖 SKILL.md 内容和 front-matter 字段
- [ ] 结果按相关度排序
- [ ] 无匹配时给出建议

---

### 7. 资源生命周期管理（归档与废弃）

**来源：** OpenSpec 的 `archive` 命令

**现状：** 过时的 skill/rule 永远留在团队 repo 中，没有清理机制。

**方案：**

```bash
teamai deprecate skill <name>    # 标记废弃，pull 时显示警告
teamai archive skill <name>      # 移入 archived/ 目录，不再同步
```

**改动范围：**
- front-matter 新增 `status: active | deprecated | archived` 字段
- `src/resources/skills.ts` — pull 时过滤 archived，警告 deprecated
- `archived/` 目录约定

**验收标准：**
- [ ] deprecated 资源 pull 时输出黄色警告
- [ ] archived 资源不参与 pull 同步
- [ ] `teamai list` 默认隐藏 archived，`--all` 显示全部

---

### 8. 冲突检测与处理

**来源：** 两个项目的版本管理思路

**现状：** pull 无条件覆盖本地修改，push 无冲突检测。

**方案：**
- pull 前检测本地文件 hash 是否与上次 pull 记录一致
- 如果本地有修改且远程也有更新，进入冲突处理：
  - `--theirs` — 使用远程版本
  - `--ours` — 保留本地版本
  - 默认交互式提示用户选择
- push 前执行 `git pull --rebase`，自动处理 git 层面冲突

**改动范围：**
- `src/resources/base.ts` — 覆盖前增加 hash 检查
- `src/pull.ts` — 冲突交互逻辑
- `src/utils/fs.ts` — 本地修改检测

**验收标准：**
- [ ] 本地未修改时静默覆盖（行为不变）
- [ ] 本地有修改时提示用户，不丢失数据
- [ ] `--silent` 模式下冲突资源跳过同步并记录日志

---

## P3 — 锦上添花

### 9. 同步 Profile 配置

**来源：** OpenSpec 的 profile 机制

**现状：** 所有成员同步完全相同的资源集合，无法按角色定制。

**方案：** 在 `teamai.yaml` 中定义 profile：

```yaml
profiles:
  minimal:
    sync: [skills]
  standard:
    sync: [skills, rules, docs]
  full:
    sync: [skills, rules, docs, hooks, instincts]
```

成员在本地配置中选择 profile：

```bash
teamai config set profile minimal
```

**改动范围：**
- `src/types.ts` — profile schema
- `src/config.ts` — profile 读取
- `src/pull.ts` / `src/push.ts` — 按 profile 过滤资源类型

---

### 10. 变更日志与通知

**来源：** Superpowers 的 RELEASE-NOTES.md

**现状：** `--silent` pull 后用户完全不知道什么变了。

**方案：**
- pull 完成后生成变更摘要，写入 `~/.teamai/changelog.log`
- `teamai changelog` 命令查看最近 N 次同步的变更
- 可选：非 `--silent` 模式下在终端输出变更摘要

```
[2026-03-04 10:30] Pull from team repo:
  + skills/code-review (new, by zhangsan)
  ~ rules/coding-standard (updated)
  - skills/old-lint (archived)
```

**改动范围：**
- `src/pull.ts` — 收集变更信息，写入日志
- `src/changelog.ts` — 新命令模块

---

## 时间线概览

```
         P0                    P1                   P2              P3
  ┌──────────────┐    ┌────────────────┐    ┌─────────────┐   ┌──────────┐
  │ 1. 元数据标准化 │    │ 3. create 脚手架 │    │ 6. 标签搜索   │   │ 9. Profile │
  │ 2. 内容级 diff │    │ 4. 选择性同步    │    │ 7. 归档/废弃  │   │10. 变更日志 │
  └──────────────┘    │ 5. validate 校验 │    │ 8. 冲突检测   │   └──────────┘
                      └────────────────┘    └─────────────┘
```

---

## 非目标 (Non-Goals)

以下是明确不在 roadmap 范围内的事项：

- **需求管理 / Spec 驱动开发** — 这是 OpenSpec 的领域，Team AI 专注于资源分发
- **开发方法论注入 (TDD 流程等)** — 这是 Superpowers 的领域，Team AI 不约束开发方式
- **替代 Git** — Team AI 基于 Git，不打算自建版本控制
- **多团队 / 多仓库支持** — 当前优先单团队场景做深做透
