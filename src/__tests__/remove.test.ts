import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fse from 'fs-extra';

// Mock external dependencies before importing modules
vi.mock('../config.js', () => ({
  requireInit: vi.fn(),
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

vi.mock('../utils/git.js', () => ({
  pushRepo: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    dim: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  })),
}));

import { RulesHandler } from '../resources/rules.js';
import { SkillsHandler } from '../resources/skills.js';
import type { TeamaiConfig, LocalConfig } from '../types.js';

describe('RulesHandler.removeItem', () => {
  let tmpDir: string;
  let homeDir: string;
  let handler: RulesHandler;
  let teamConfig: TeamaiConfig;
  let localConfig: LocalConfig;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-remove-test-'));
    homeDir = path.join(tmpDir, 'home');

    // Create team repo rules dir
    const repoPath = path.join(tmpDir, 'team-repo');
    await fse.ensureDir(path.join(repoPath, 'rules'));

    // Create home tool directories
    await fse.ensureDir(path.join(homeDir, '.claude', 'rules'));
    await fse.ensureDir(path.join(homeDir, '.codex', 'rules'));
    await fse.ensureDir(path.join(homeDir, '.claude-internal', 'rules'));

    // Stub HOME
    vi.stubEnv('HOME', homeDir);

    handler = new RulesHandler();

    teamConfig = {
      team: 'test',
      description: '',
      repo: 'https://git.woa.com/test/repo.git',
      sharing: { skills: { syncTargets: [] }, rules: { enforced: [] }, docs: { localDir: '' } },
      toolPaths: {
        claude: { skills: '.claude/skills', rules: '.claude/rules', settings: '.claude/settings.json', claudemd: '.claude/CLAUDE.md' },
        codex: { skills: '.codex/skills', rules: '.codex/rules' },
        'claude-internal': { skills: '.claude-internal/skills', rules: '.claude-internal/rules', settings: '.claude-internal/settings.json', claudemd: '.claude-internal/CLAUDE.md' },
      },
    };

    localConfig = {
      repo: { localPath: repoPath, remote: 'https://git.woa.com/test/repo.git' },
      username: 'testuser',
    };
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fse.remove(tmpDir);
  });

  it('should remove rule from team repo and all tool directories', async () => {
    // Create the rule in team repo
    await fse.writeFile(path.join(localConfig.repo.localPath, 'rules', 'my-rule.md'), 'rule content');
    // Create the rule in tool directories
    await fse.writeFile(path.join(homeDir, '.claude', 'rules', 'my-rule.md'), 'rule content');
    await fse.writeFile(path.join(homeDir, '.codex', 'rules', 'my-rule.md'), 'rule content');
    await fse.writeFile(path.join(homeDir, '.claude-internal', 'rules', 'my-rule.md'), 'rule content');

    const removed = await handler.removeItem('my-rule', teamConfig, localConfig);

    expect(removed.length).toBe(4); // team repo + 3 tools
    expect(await fse.pathExists(path.join(localConfig.repo.localPath, 'rules', 'my-rule.md'))).toBe(false);
    expect(await fse.pathExists(path.join(homeDir, '.claude', 'rules', 'my-rule.md'))).toBe(false);
    expect(await fse.pathExists(path.join(homeDir, '.codex', 'rules', 'my-rule.md'))).toBe(false);
    expect(await fse.pathExists(path.join(homeDir, '.claude-internal', 'rules', 'my-rule.md'))).toBe(false);
  });

  it('should only remove from locations where the rule exists', async () => {
    // Only create in team repo and one tool
    await fse.writeFile(path.join(localConfig.repo.localPath, 'rules', 'partial-rule.md'), 'content');
    await fse.writeFile(path.join(homeDir, '.claude', 'rules', 'partial-rule.md'), 'content');

    const removed = await handler.removeItem('partial-rule', teamConfig, localConfig);

    expect(removed.length).toBe(2); // team repo + claude only
  });

  it('should return empty array when rule does not exist anywhere', async () => {
    const removed = await handler.removeItem('nonexistent', teamConfig, localConfig);

    expect(removed.length).toBe(0);
  });

  it('should not affect other rules when removing one', async () => {
    await fse.writeFile(path.join(localConfig.repo.localPath, 'rules', 'keep-me.md'), 'keep');
    await fse.writeFile(path.join(localConfig.repo.localPath, 'rules', 'delete-me.md'), 'delete');
    await fse.writeFile(path.join(homeDir, '.claude', 'rules', 'keep-me.md'), 'keep');
    await fse.writeFile(path.join(homeDir, '.claude', 'rules', 'delete-me.md'), 'delete');

    await handler.removeItem('delete-me', teamConfig, localConfig);

    expect(await fse.pathExists(path.join(localConfig.repo.localPath, 'rules', 'keep-me.md'))).toBe(true);
    expect(await fse.pathExists(path.join(homeDir, '.claude', 'rules', 'keep-me.md'))).toBe(true);
    expect(await fse.pathExists(path.join(localConfig.repo.localPath, 'rules', 'delete-me.md'))).toBe(false);
    expect(await fse.pathExists(path.join(homeDir, '.claude', 'rules', 'delete-me.md'))).toBe(false);
  });
});

describe('SkillsHandler.removeItem', () => {
  let tmpDir: string;
  let homeDir: string;
  let handler: SkillsHandler;
  let teamConfig: TeamaiConfig;
  let localConfig: LocalConfig;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-remove-test-'));
    homeDir = path.join(tmpDir, 'home');

    const repoPath = path.join(tmpDir, 'team-repo');
    await fse.ensureDir(path.join(repoPath, 'skills'));

    await fse.ensureDir(path.join(homeDir, '.claude', 'skills'));
    await fse.ensureDir(path.join(homeDir, '.codex', 'skills'));

    vi.stubEnv('HOME', homeDir);

    handler = new SkillsHandler();

    teamConfig = {
      team: 'test',
      description: '',
      repo: 'https://git.woa.com/test/repo.git',
      sharing: {
        skills: { syncTargets: ['claude', 'codex'] },
        rules: { enforced: [] },
        docs: { localDir: '' },
      },
      toolPaths: {
        claude: { skills: '.claude/skills', rules: '.claude/rules' },
        codex: { skills: '.codex/skills', rules: '.codex/rules' },
      },
    };

    localConfig = {
      repo: { localPath: repoPath, remote: 'https://git.woa.com/test/repo.git' },
      username: 'testuser',
    };
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fse.remove(tmpDir);
  });

  it('should remove skill directory from team repo and all sync targets', async () => {
    // Create skill directories with SKILL.md
    const teamSkill = path.join(localConfig.repo.localPath, 'skills', 'my-skill');
    await fse.ensureDir(teamSkill);
    await fse.writeFile(path.join(teamSkill, 'SKILL.md'), '# My Skill');

    const claudeSkill = path.join(homeDir, '.claude', 'skills', 'my-skill');
    await fse.ensureDir(claudeSkill);
    await fse.writeFile(path.join(claudeSkill, 'SKILL.md'), '# My Skill');

    const codexSkill = path.join(homeDir, '.codex', 'skills', 'my-skill');
    await fse.ensureDir(codexSkill);
    await fse.writeFile(path.join(codexSkill, 'SKILL.md'), '# My Skill');

    const removed = await handler.removeItem('my-skill', teamConfig, localConfig);

    expect(removed.length).toBe(3);
    expect(await fse.pathExists(teamSkill)).toBe(false);
    expect(await fse.pathExists(claudeSkill)).toBe(false);
    expect(await fse.pathExists(codexSkill)).toBe(false);
  });

  it('should only remove from locations where the skill exists', async () => {
    const teamSkill = path.join(localConfig.repo.localPath, 'skills', 'partial-skill');
    await fse.ensureDir(teamSkill);
    await fse.writeFile(path.join(teamSkill, 'SKILL.md'), '# Skill');

    const removed = await handler.removeItem('partial-skill', teamConfig, localConfig);

    expect(removed.length).toBe(1);
    expect(await fse.pathExists(teamSkill)).toBe(false);
  });

  it('should return empty array when skill does not exist', async () => {
    const removed = await handler.removeItem('ghost-skill', teamConfig, localConfig);
    expect(removed.length).toBe(0);
  });

  it('should not affect other skills when removing one', async () => {
    const keepSkill = path.join(localConfig.repo.localPath, 'skills', 'keep-skill');
    await fse.ensureDir(keepSkill);
    await fse.writeFile(path.join(keepSkill, 'SKILL.md'), '# Keep');

    const deleteSkill = path.join(localConfig.repo.localPath, 'skills', 'delete-skill');
    await fse.ensureDir(deleteSkill);
    await fse.writeFile(path.join(deleteSkill, 'SKILL.md'), '# Delete');

    await handler.removeItem('delete-skill', teamConfig, localConfig);

    expect(await fse.pathExists(keepSkill)).toBe(true);
    expect(await fse.pathExists(deleteSkill)).toBe(false);
  });
});
