/**
 * Phase 1 人工验收 Demo
 * 直接运行真实逻辑，捕获并打印关键输出供人工确认
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fse from 'fs-extra';
import { vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  requireInit: vi.fn(),
  loadState: vi.fn().mockImplementation(async () => ({ lastPull: null })),
  saveState: vi.fn(),
  loadLocalConfigForScope: vi.fn(),
  loadTeamConfig: vi.fn(),
  detectProjectConfig: vi.fn().mockResolvedValue(null),
  loadStateForScope: vi.fn().mockImplementation(async () => ({ lastPull: null })),
  saveStateForScope: vi.fn(),
}));
vi.mock('../src/utils/git.js', () => ({
  pullRepo: vi.fn().mockResolvedValue('Already up to date.'),
  getHeadRev: vi.fn().mockResolvedValue('deadbeef'),
}));
vi.mock('../src/utils/logger.js', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), dim: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis() })),
}));
vi.mock('../src/team-push.js', () => ({ reportUsageToTeam: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/source.js', () => ({ pullSources: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/skill-recommend.js', () => ({ getRecommendations: vi.fn().mockResolvedValue([]), displayRecommendations: vi.fn() }));
vi.mock('../src/roles.js', () => ({ loadRolesManifest: vi.fn().mockRejectedValue(new Error('no roles')), resolveRoleResourceNamespaces: vi.fn() }));

import { pull } from '../src/pull.js';
import { recall } from '../src/recall.js';
import { loadLocalConfigForScope, loadTeamConfig, requireInit } from '../src/config.js';
import { TEAMAI_RECALL_RULES_START, TEAMAI_RECALL_RULES_END } from '../src/types.js';

let tmpDir: string, homeDir: string, repoPath: string;

async function setupFixture() {
  tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-demo-'));
  homeDir = path.join(tmpDir, 'home');
  repoPath = path.join(tmpDir, 'team-repo');

  await fse.ensureDir(path.join(homeDir, '.claude', 'agents'));
  await fse.ensureDir(path.join(homeDir, '.claude', 'skills'));
  await fse.ensureDir(path.join(homeDir, '.claude', 'rules'));
  await fse.writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), '# Existing user content\n');
  await fse.ensureDir(path.join(homeDir, '.cursor', 'skills'));
  await fse.ensureDir(path.join(homeDir, '.cursor', 'rules'));

  // team repo
  await fse.ensureDir(path.join(repoPath, 'agents'));
  await fse.writeFile(path.join(repoPath, 'agents', 'code-reviewer.md'),
    '---\nname: code-reviewer\ndescription: Review PRs\ntools: Read,Grep\n---\nReview the diff carefully.\n');
  await fse.ensureDir(path.join(repoPath, 'learnings'));
  await fse.writeFile(path.join(repoPath, 'learnings', 'api-timeout-2026-03-20.md'),
    '---\ntitle: "Resolved API timeout via retry backoff"\ntags: [api, retry]\n---\nIncrease retry backoff for sglang.\n');
  await fse.ensureDir(path.join(repoPath, 'docs'));
  await fse.writeFile(path.join(repoPath, 'docs', 'codebase.md'),
    '---\ntitle: Codebase overview\ntags: [overview]\n---\nThis repo handles api requests.\n');
  await fse.ensureDir(path.join(repoPath, 'rules', 'common'));
  await fse.writeFile(path.join(repoPath, 'rules', 'common', 'coding-style.md'),
    '---\ntitle: Coding style\ntags: [style]\n---\nUse 4-space indentation.\n');
  await fse.ensureDir(path.join(repoPath, 'skills', 'team-helper'));
  await fse.writeFile(path.join(repoPath, 'skills', 'team-helper', 'SKILL.md'),
    '---\nname: team-helper\ndescription: A helper skill\n---\nDo team things.\n');

  vi.stubEnv('HOME', homeDir);

  const localConfig = {
    repo: { localPath: repoPath, remote: 'https://example.com/repo.git' },
    username: 'demo-user', updatePolicy: 'auto', additionalRoles: [], scope: 'user',
  };
  const teamConfig = {
    team: 'demo', repo: 'https://example.com/repo.git', provider: 'tgit', reviewers: [],
    sharing: { skills: {}, rules: { enforced: [] }, docs: { localDir: '' }, env: { injectShellProfile: false } },
    toolPaths: {
      claude: { skills: '.claude/skills', rules: '.claude/rules', agents: '.claude/agents', claudemd: '.claude/CLAUDE.md' },
      cursor: { skills: '.cursor/skills', rules: '.cursor/rules' },
    },
  };
  vi.mocked(loadLocalConfigForScope).mockResolvedValue(localConfig as any);
  vi.mocked(loadTeamConfig).mockResolvedValue(teamConfig as any);
  vi.mocked(requireInit).mockResolvedValue({ localConfig, teamConfig } as any);
}

describe('Phase 1 人工验收 Demo', () => {
  beforeAll(async () => { await setupFixture(); await pull({}); });
  afterAll(async () => { vi.unstubAllEnvs(); await fse.remove(tmpDir); });

  it('【P1.0】agents 同步 — 文件落地路径', async () => {
    const agentPath = path.join(homeDir, '.claude', 'agents', 'code-reviewer.md');
    const recallPath = path.join(homeDir, '.claude', 'agents', 'teamai-recall.md');
    const cursorAgents = path.join(homeDir, '.cursor', 'agents');
    console.log('\n─── P1.0 agents 同步 ───');
    console.log('team agent 落地路径:', agentPath);
    console.log('文件存在?', await fse.pathExists(agentPath));
    console.log('内置 teamai-recall 存在?', await fse.pathExists(recallPath));
    console.log('cursor agents 目录存在(应为 false):', await fse.pathExists(cursorAgents));
  });

  it('【P1.2】CLAUDE.md 注入 — 注入块原文', async () => {
    const claudeMd = await fse.readFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'utf8');
    console.log('\n─── P1.2 CLAUDE.md 注入块（原文） ───');
    console.log(claudeMd);
    console.log('包含 RECALL_RULES_START?', claudeMd.includes(TEAMAI_RECALL_RULES_START));
    console.log('包含 RECALL_RULES_END?',   claudeMd.includes(TEAMAI_RECALL_RULES_END));
    console.log('原有内容仍保留?', claudeMd.includes('Existing user content'));
    console.log('cursor 无 CLAUDE.md(应为 false):', await fse.pathExists(path.join(homeDir, '.cursor', 'CLAUDE.md')));
  });

  it('【P1.3】search-index.json — 四类条目', async () => {
    const indexPath = path.join(homeDir, '.teamai', 'search-index.json');
    const index = await fse.readJson(indexPath);
    const entries = index.entries as Array<{type: string; title: string; domain: string}>;
    console.log('\n─── P1.3 search-index.json 条目列表 ───');
    console.log(`索引版本: ${index.version},  条目总数: ${entries.length}`);
    for (const e of entries) {
      console.log(`  [${e.type}] domain=${e.domain}  "${e.title}"`);
    }
    const types = [...new Set(entries.map(e => e.type))].sort();
    console.log('覆盖类型:', types.join(', '));
  });

  it('【P1.1 + P1.4】recall() 真实 STDOUT — 包络标记 + 类型标签 + domain 权重', async () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk)); return true;
    });
    try {
      await recall('api', { dryRun: true });
    } finally {
      (process.stdout.write as any).mockRestore?.();
      process.stdout.write = origWrite;
    }
    const stdout = chunks.join('');
    console.log('\n─── recall("api") 真实 STDOUT ───');
    console.log(stdout);
    console.log('包含 [teamai:recall:start]?', stdout.includes('[teamai:recall:start]'));
    console.log('包含 [teamai:recall:end]?',   stdout.includes('[teamai:recall:end]'));
    console.log('包含类型标签?', /\[(docs|learnings|rules|skills)\]/.test(stdout));
  });
});
