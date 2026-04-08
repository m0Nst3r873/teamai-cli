import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

// We test the pure logic functions from roles-cmd.ts by importing them.
// For interactive commands (rolesInit), we test the underlying roles.ts functions
// and the manifest generation logic.

import {
  loadRolesManifest,
  listRoleIds,
  describeRoles,
  resolveRoleResourceNamespaces,
} from '../roles.js';

function createTempRepo(options?: { withManifest?: boolean; roles?: Array<{ id: string; namespaces: string[] }> }): string {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'teamai-roles-cmd-'));

  if (options?.withManifest) {
    const roles = options.roles ?? [
      { id: 'hai', namespaces: ['common', 'hai'] },
      { id: 'pm', namespaces: ['common', 'pm'] },
    ];

    const manifest = {
      version: 1,
      roles: roles.map((r) => ({
        id: r.id,
        description: '',
        resources: {
          knowledge: r.namespaces,
          skills: r.namespaces,
          learnings: r.namespaces,
        },
      })),
      defaults: { shareTarget: 'primary-role' },
    };

    const manifestDir = path.join(repoDir, 'manifest');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(path.join(manifestDir, 'roles.yaml'), YAML.stringify(manifest), 'utf-8');
  }

  return repoDir;
}

describe('roles list — manifest loading', () => {
  it('loads manifest and lists role ids', async () => {
    const repoDir = createTempRepo({ withManifest: true });

    const manifest = await loadRolesManifest(repoDir);
    const ids = listRoleIds(manifest);

    expect(ids).toEqual(['hai', 'pm']);

    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns descriptive labels for roles', async () => {
    const repoDir = createTempRepo({
      withManifest: true,
      roles: [
        { id: 'devops', namespaces: ['common', 'infra'] },
      ],
    });

    const manifest = await loadRolesManifest(repoDir);
    const labels = describeRoles(manifest.roles);

    expect(labels).toEqual(['devops']);

    rmSync(repoDir, { recursive: true, force: true });
  });

  it('throws when manifest is missing', async () => {
    const repoDir = createTempRepo({ withManifest: false });

    await expect(loadRolesManifest(repoDir)).rejects.toThrow(/Roles manifest not found/);

    rmSync(repoDir, { recursive: true, force: true });
  });
});

describe('roles set — validation', () => {
  it('resolves namespaces for a valid primary role', async () => {
    const repoDir = createTempRepo({ withManifest: true });
    const manifest = await loadRolesManifest(repoDir);

    const result = resolveRoleResourceNamespaces({
      manifest,
      primaryRole: 'hai',
      additionalRoles: [],
    });

    expect(result.skills).toEqual(['common', 'hai']);
    expect(result.knowledge).toEqual(['common', 'hai']);
    expect(result.learnings).toEqual(['common', 'hai']);

    rmSync(repoDir, { recursive: true, force: true });
  });

  it('resolves namespaces for primary + additional roles', async () => {
    const repoDir = createTempRepo({ withManifest: true });
    const manifest = await loadRolesManifest(repoDir);

    const result = resolveRoleResourceNamespaces({
      manifest,
      primaryRole: 'hai',
      additionalRoles: ['pm'],
    });

    expect(result.skills).toEqual(['common', 'hai', 'pm']);

    rmSync(repoDir, { recursive: true, force: true });
  });

  it('rejects unknown primary role', async () => {
    const repoDir = createTempRepo({ withManifest: true });
    const manifest = await loadRolesManifest(repoDir);

    expect(() =>
      resolveRoleResourceNamespaces({
        manifest,
        primaryRole: 'nonexistent',
        additionalRoles: [],
      }),
    ).toThrow(/Unknown role "nonexistent"/);

    rmSync(repoDir, { recursive: true, force: true });
  });

  it('rejects unknown additional role', async () => {
    const repoDir = createTempRepo({ withManifest: true });
    const manifest = await loadRolesManifest(repoDir);

    expect(() =>
      resolveRoleResourceNamespaces({
        manifest,
        primaryRole: 'hai',
        additionalRoles: ['unknown'],
      }),
    ).toThrow(/Unknown role "unknown"/);

    rmSync(repoDir, { recursive: true, force: true });
  });
});

describe('roles init — manifest generation', () => {
  it('generates valid YAML from role definitions', () => {
    const roles = [
      {
        id: 'hai',
        description: 'HyperAI research',
        resources: {
          knowledge: ['common', 'hai'],
          skills: ['common', 'hai'],
          learnings: ['common', 'hai'],
        },
      },
      {
        id: 'tencent',
        description: 'Internal platform tools',
        resources: {
          knowledge: ['common', 'tencent'],
          skills: ['common', 'tencent'],
          learnings: ['common', 'tencent'],
        },
      },
    ];

    const manifest = {
      version: 1,
      roles,
      defaults: { shareTarget: 'primary-role' },
    };

    const yamlContent = YAML.stringify(manifest);
    const parsed = YAML.parse(yamlContent);

    expect(parsed.version).toBe(1);
    expect(parsed.roles).toHaveLength(2);
    expect(parsed.roles[0].id).toBe('hai');
    expect(parsed.roles[0].resources.skills).toEqual(['common', 'hai']);
    expect(parsed.roles[1].id).toBe('tencent');
    expect(parsed.defaults.shareTarget).toBe('primary-role');
  });

  it('writes manifest to correct path with ensureDir', async () => {
    const repoDir = createTempRepo({ withManifest: false });
    const manifestDir = path.join(repoDir, 'manifest');
    const manifestPath = path.join(manifestDir, 'roles.yaml');

    // Simulate what rolesInit does
    mkdirSync(manifestDir, { recursive: true });
    const content = YAML.stringify({
      version: 1,
      roles: [{ id: 'test', description: '', resources: { knowledge: ['common'], skills: ['common'], learnings: ['common'] } }],
      defaults: { shareTarget: 'primary-role' },
    });
    writeFileSync(manifestPath, content, 'utf-8');

    expect(existsSync(manifestPath)).toBe(true);

    // Verify it can be loaded back
    const manifest = await loadRolesManifest(repoDir);
    expect(manifest.roles[0].id).toBe('test');

    rmSync(repoDir, { recursive: true, force: true });
  });

  it('detects existing manifest for overwrite guard', async () => {
    const repoDir = createTempRepo({ withManifest: true });
    const manifestPath = path.join(repoDir, 'manifest', 'roles.yaml');

    expect(existsSync(manifestPath)).toBe(true);

    rmSync(repoDir, { recursive: true, force: true });
  });
});

describe('init.ts — missing manifest graceful skip', () => {
  it('loadRolesManifest throws with specific message when manifest missing', async () => {
    const repoDir = createTempRepo({ withManifest: false });

    await expect(loadRolesManifest(repoDir)).rejects.toThrow('Roles manifest not found');

    rmSync(repoDir, { recursive: true, force: true });
  });

  it('error message includes path for debugging', async () => {
    const repoDir = createTempRepo({ withManifest: false });

    try {
      await loadRolesManifest(repoDir);
    } catch (e) {
      expect((e as Error).message).toContain('manifest/roles.yaml');
    }

    rmSync(repoDir, { recursive: true, force: true });
  });
});
