import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fse from 'fs-extra';
import YAML from 'yaml';

// Mock external dependencies before importing modules
vi.mock('../config.js', () => ({
  requireInit: vi.fn(),
}));

vi.mock('../utils/git.js', () => ({
  pullRepo: vi.fn().mockResolvedValue('Already up to date.'),
  pushRepoBranch: vi.fn().mockResolvedValue(true),
  generateBranchName: vi.fn().mockReturnValue('teamai/push/test/20260305-120000'),
}));

vi.mock('../utils/gf-cli.js', () => ({
  gfMrCreate: vi.fn().mockReturnValue('https://git.woa.com/mr/1'),
}));

vi.mock('../utils/repo-url.js', () => ({
  parseRepoInput: vi.fn().mockReturnValue({ owner: 'test', repo: 'repo', projectId: 'test%2Frepo' }),
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
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

import { envList, envAdd, envRemove } from '../env-commands.js';
import { requireInit } from '../config.js';
import { pushRepoBranch } from '../utils/git.js';
import { gfMrCreate } from '../utils/gf-cli.js';
import { log } from '../utils/logger.js';
import type { TeamaiConfig, LocalConfig } from '../types.js';

describe('env-commands', () => {
  let tmpDir: string;
  let repoPath: string;
  let teamConfig: TeamaiConfig;
  let localConfig: LocalConfig;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-env-cmd-test-'));
    repoPath = path.join(tmpDir, 'team-repo');
    await fse.ensureDir(path.join(repoPath, 'env'));

    vi.stubEnv('HOME', path.join(tmpDir, 'home'));

    teamConfig = {
      team: 'test',
      description: '',
      repo: 'https://git.woa.com/test/repo.git',
      reviewers: [],
      sharing: {
        skills: { syncTargets: [] },
        rules: { enforced: [] },
        docs: { localDir: '' },
        env: { injectShellProfile: true },
      },
      toolPaths: {},
    };

    localConfig = {
      repo: { localPath: repoPath, remote: 'https://git.woa.com/test/repo.git' },
      username: 'testuser',
    };

    vi.mocked(requireInit).mockResolvedValue({ localConfig, teamConfig });
    vi.mocked(pushRepoBranch).mockReset().mockResolvedValue(true);
    vi.mocked(gfMrCreate).mockReset().mockReturnValue('https://git.woa.com/mr/1');
    vi.mocked(log.info).mockClear();
    vi.mocked(log.error).mockClear();
    vi.mocked(log.dim).mockClear();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    consoleSpy.mockRestore();
    await fse.remove(tmpDir);
  });

  // ─── envList ─────────────────────────────────────────────

  describe('envList', () => {
    it('should show message when env.yaml does not exist', async () => {
      await envList({});
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('No env variables'));
    });

    it('should show message when env.yaml has no variables', async () => {
      await fse.writeFile(
        path.join(repoPath, 'env', 'env.yaml'),
        YAML.stringify({ variables: [] }),
      );

      await envList({});
      expect(log.info).toHaveBeenCalledWith('No env variables defined');
    });

    it('should list variables', async () => {
      await fse.writeFile(
        path.join(repoPath, 'env', 'env.yaml'),
        YAML.stringify({
          variables: [
            { key: 'API_URL', value: 'https://api.example.com', description: 'API endpoint' },
            { key: 'TOKEN', value: 'secret' },
          ],
        }),
      );

      await envList({});

      const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('Team env variables (2)');
      expect(allOutput).toContain('API_URL=https://api.example.com');
      expect(allOutput).toContain('TOKEN=secret');
    });

    it('should show descriptions in verbose mode', async () => {
      await fse.writeFile(
        path.join(repoPath, 'env', 'env.yaml'),
        YAML.stringify({
          variables: [
            { key: 'API_URL', value: 'https://api.example.com', description: 'My API endpoint' },
          ],
        }),
      );

      await envList({ verbose: true });

      expect(log.dim).toHaveBeenCalledWith(expect.stringContaining('My API endpoint'));
    });
  });

  // ─── envAdd ──────────────────────────────────────────────

  describe('envAdd', () => {
    it('should add a new variable and create branch + MR', async () => {
      await envAdd('NEW_VAR', 'new_value', {});

      // Verify env.yaml was written
      const envYamlPath = path.join(repoPath, 'env', 'env.yaml');
      const content = await fse.readFile(envYamlPath, 'utf-8');
      const parsed = YAML.parse(content);
      expect(parsed.variables).toHaveLength(1);
      expect(parsed.variables[0]).toEqual({ key: 'NEW_VAR', value: 'new_value' });

      // Verify branch push
      expect(pushRepoBranch).toHaveBeenCalledWith(
        repoPath,
        '[teamai] Add env variable: NEW_VAR',
        ['env/'],
        expect.any(String),
      );

      // Verify MR creation
      expect(gfMrCreate).toHaveBeenCalled();
    });

    it('should add variable with description', async () => {
      await envAdd('MY_VAR', 'val', { description: 'A test variable' });

      const envYamlPath = path.join(repoPath, 'env', 'env.yaml');
      const content = await fse.readFile(envYamlPath, 'utf-8');
      const parsed = YAML.parse(content);
      expect(parsed.variables[0]).toEqual({
        key: 'MY_VAR',
        value: 'val',
        description: 'A test variable',
      });
    });

    it('should update existing variable', async () => {
      // Pre-populate env.yaml
      await fse.writeFile(
        path.join(repoPath, 'env', 'env.yaml'),
        YAML.stringify({
          variables: [{ key: 'EXIST_VAR', value: 'old_value' }],
        }),
      );

      await envAdd('EXIST_VAR', 'new_value', {});

      const envYamlPath = path.join(repoPath, 'env', 'env.yaml');
      const content = await fse.readFile(envYamlPath, 'utf-8');
      const parsed = YAML.parse(content);
      expect(parsed.variables).toHaveLength(1);
      expect(parsed.variables[0].value).toBe('new_value');

      // Should use "Update" in commit message
      expect(pushRepoBranch).toHaveBeenCalledWith(
        repoPath,
        '[teamai] Update env variable: EXIST_VAR',
        ['env/'],
        expect.any(String),
      );
    });

    it('should not write or push in dry-run mode', async () => {
      await envAdd('DRY_VAR', 'dry_value', { dryRun: true });

      // env.yaml should NOT exist
      const envYamlPath = path.join(repoPath, 'env', 'env.yaml');
      expect(await fse.pathExists(envYamlPath)).toBe(false);

      expect(pushRepoBranch).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('[dry-run]'));
    });

    it('should handle no changes gracefully', async () => {
      vi.mocked(pushRepoBranch).mockResolvedValueOnce(false);

      await envAdd('NO_CHANGE', 'val', {});

      expect(gfMrCreate).not.toHaveBeenCalled();
    });
  });

  // ─── envRemove ───────────────────────────────────────────

  describe('envRemove', () => {
    it('should remove existing variable and create branch + MR', async () => {
      await fse.writeFile(
        path.join(repoPath, 'env', 'env.yaml'),
        YAML.stringify({
          variables: [
            { key: 'KEEP', value: 'a' },
            { key: 'REMOVE_ME', value: 'b' },
          ],
        }),
      );

      await envRemove('REMOVE_ME', {});

      // Verify env.yaml was updated
      const content = await fse.readFile(path.join(repoPath, 'env', 'env.yaml'), 'utf-8');
      const parsed = YAML.parse(content);
      expect(parsed.variables).toHaveLength(1);
      expect(parsed.variables[0].key).toBe('KEEP');

      // Verify branch push
      expect(pushRepoBranch).toHaveBeenCalledWith(
        repoPath,
        '[teamai] Remove env variable: REMOVE_ME',
        ['env/'],
        expect.any(String),
      );

      expect(gfMrCreate).toHaveBeenCalled();
    });

    it('should error when env.yaml does not exist', async () => {
      // Remove the env dir to ensure no env.yaml
      await fse.remove(path.join(repoPath, 'env'));

      await envRemove('MISSING', {});

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(pushRepoBranch).not.toHaveBeenCalled();
    });

    it('should error when variable key does not exist', async () => {
      await fse.writeFile(
        path.join(repoPath, 'env', 'env.yaml'),
        YAML.stringify({
          variables: [{ key: 'OTHER', value: 'x' }],
        }),
      );

      await envRemove('NONEXIST', {});

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('"NONEXIST" not found'));
      expect(pushRepoBranch).not.toHaveBeenCalled();
    });

    it('should not modify or push in dry-run mode', async () => {
      await fse.writeFile(
        path.join(repoPath, 'env', 'env.yaml'),
        YAML.stringify({
          variables: [{ key: 'DRY_VAR', value: 'x' }],
        }),
      );

      await envRemove('DRY_VAR', { dryRun: true });

      // Variable should still be there
      const content = await fse.readFile(path.join(repoPath, 'env', 'env.yaml'), 'utf-8');
      const parsed = YAML.parse(content);
      expect(parsed.variables).toHaveLength(1);

      expect(pushRepoBranch).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('[dry-run]'));
    });
  });
});
