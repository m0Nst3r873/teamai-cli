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
  pushRepo: vi.fn(),
  pullRepo: vi.fn(),
}));

vi.mock('../utils/tgit-api.js', () => ({
  searchUsers: vi.fn(),
  addProjectMember: vi.fn(),
  updateProjectMember: vi.fn(),
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
  })),
}));

import { getMemberConfig, requireWriteRole, listMembers } from '../members.js';
import { requireInit } from '../config.js';

describe('getMemberConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-test-'));
    await fse.ensureDir(path.join(tmpDir, 'members'));
  });

  afterEach(async () => {
    await fse.remove(tmpDir);
  });

  it('should return null for non-existent member', async () => {
    const result = await getMemberConfig(tmpDir, 'nobody');
    expect(result).toBeNull();
  });

  it('should parse a valid member YAML with role', async () => {
    const memberData = {
      username: 'alice',
      displayName: 'Alice Chen',
      registeredAt: '2025-01-01T00:00:00.000Z',
      role: 'write',
    };
    await fse.writeFile(
      path.join(tmpDir, 'members', 'alice.yaml'),
      YAML.stringify(memberData),
    );

    const result = await getMemberConfig(tmpDir, 'alice');
    expect(result).toEqual(memberData);
  });

  it('should default role to readonly for legacy YAML without role field', async () => {
    const legacyData = {
      username: 'bob',
      displayName: 'Bob Li',
      registeredAt: '2025-01-01T00:00:00.000Z',
    };
    await fse.writeFile(
      path.join(tmpDir, 'members', 'bob.yaml'),
      YAML.stringify(legacyData),
    );

    const result = await getMemberConfig(tmpDir, 'bob');
    expect(result).not.toBeNull();
    expect(result!.role).toBe('readonly');
  });

  it('should return null for invalid YAML content', async () => {
    await fse.writeFile(
      path.join(tmpDir, 'members', 'bad.yaml'),
      '{{invalid yaml: [',
    );

    const result = await getMemberConfig(tmpDir, 'bad');
    expect(result).toBeNull();
  });
});

describe('requireWriteRole', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-test-'));
    await fse.ensureDir(path.join(tmpDir, 'members'));
  });

  afterEach(async () => {
    await fse.remove(tmpDir);
  });

  it('should throw if user is not a member', async () => {
    await expect(requireWriteRole(tmpDir, 'ghost')).rejects.toThrow(
      'not a registered member',
    );
  });

  it('should throw if user has readonly role', async () => {
    await fse.writeFile(
      path.join(tmpDir, 'members', 'viewer.yaml'),
      YAML.stringify({
        username: 'viewer',
        displayName: 'Viewer',
        registeredAt: '2025-01-01T00:00:00.000Z',
        role: 'readonly',
      }),
    );

    await expect(requireWriteRole(tmpDir, 'viewer')).rejects.toThrow(
      "Permission denied",
    );
  });

  it('should throw for legacy member without role field (defaults to readonly)', async () => {
    await fse.writeFile(
      path.join(tmpDir, 'members', 'legacy.yaml'),
      YAML.stringify({
        username: 'legacy',
        displayName: 'Legacy User',
        registeredAt: '2025-01-01T00:00:00.000Z',
      }),
    );

    await expect(requireWriteRole(tmpDir, 'legacy')).rejects.toThrow(
      "Permission denied",
    );
  });

  it('should pass for user with write role', async () => {
    await fse.writeFile(
      path.join(tmpDir, 'members', 'admin.yaml'),
      YAML.stringify({
        username: 'admin',
        displayName: 'Admin',
        registeredAt: '2025-01-01T00:00:00.000Z',
        role: 'write',
      }),
    );

    await expect(requireWriteRole(tmpDir, 'admin')).resolves.toBeUndefined();
  });
});

describe('listMembers', () => {
  let tmpDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-test-'));
    await fse.ensureDir(path.join(tmpDir, 'members'));
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    await fse.remove(tmpDir);
  });

  it('should display role tags in member list', async () => {
    // Create members
    await fse.writeFile(
      path.join(tmpDir, 'members', 'alice.yaml'),
      YAML.stringify({
        username: 'alice',
        displayName: 'Alice Chen',
        registeredAt: '2025-01-01T00:00:00.000Z',
        role: 'write',
      }),
    );
    await fse.writeFile(
      path.join(tmpDir, 'members', 'bob.yaml'),
      YAML.stringify({
        username: 'bob',
        displayName: 'Bob Li',
        registeredAt: '2025-01-01T00:00:00.000Z',
        role: 'readonly',
      }),
    );

    vi.mocked(requireInit).mockResolvedValue({
      localConfig: {
        repo: { localPath: tmpDir, remote: 'https://git.woa.com/team/repo.git' },
        username: 'alice',
      },
      teamConfig: {
        team: 'test',
        description: '',
        repo: 'https://git.woa.com/team/repo.git',
        sharing: { skills: { syncTargets: [] }, rules: { enforced: [] }, docs: { localDir: '' } },
        toolPaths: {},
      },
    });

    await listMembers({});

    const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toContain('[write]');
    expect(allOutput).toContain('[readonly]');
    expect(allOutput).toContain('(you)');
    expect(allOutput).toContain('alice');
    expect(allOutput).toContain('bob');
  });

  it('should show default readonly role for legacy members', async () => {
    await fse.writeFile(
      path.join(tmpDir, 'members', 'legacy.yaml'),
      YAML.stringify({
        username: 'legacy',
        displayName: 'Legacy User',
        registeredAt: '2025-01-01T00:00:00.000Z',
      }),
    );

    vi.mocked(requireInit).mockResolvedValue({
      localConfig: {
        repo: { localPath: tmpDir, remote: 'https://git.woa.com/team/repo.git' },
        username: 'other',
      },
      teamConfig: {
        team: 'test',
        description: '',
        repo: 'https://git.woa.com/team/repo.git',
        sharing: { skills: { syncTargets: [] }, rules: { enforced: [] }, docs: { localDir: '' } },
        toolPaths: {},
      },
    });

    await listMembers({});

    const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toContain('[readonly]');
    expect(allOutput).toContain('legacy');
  });
});
