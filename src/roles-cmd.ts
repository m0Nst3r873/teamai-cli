import readline from 'node:readline';
import path from 'node:path';
import YAML from 'yaml';
import { autoDetectInit, loadLocalConfig, saveLocalConfig, loadTeamConfig, saveLocalConfigForScope } from './config.js';
import { loadRolesManifest, describeRoles, listRoleIds } from './roles.js';
import { pullRepo, pushRepoBranch, checkoutMaster, generateBranchName } from './utils/git.js';
import { ensureDir, pathExists, writeFile, expandHome } from './utils/fs.js';
import { log, spinner } from './utils/logger.js';
import { createPrWithFallback } from './push.js';
import type { GlobalOptions } from './types.js';

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── roles init ─────────────────────────────────────────

export async function rolesInit(options: GlobalOptions): Promise<void> {
  const { localConfig, teamConfig } = await autoDetectInit();
  const repoPath = localConfig.repo.localPath;

  // Pull latest
  const pullSpin = spinner('Pulling latest master...').start();
  try {
    await pullRepo(repoPath);
    pullSpin.succeed('Master up to date');
  } catch (e) {
    pullSpin.warn(`Pull failed: ${(e as Error).message}`);
  }

  // Check if manifest already exists
  const manifestDir = path.join(repoPath, 'manifest');
  const manifestPath = path.join(manifestDir, 'roles.yaml');
  if (await pathExists(manifestPath)) {
    log.warn(`Roles manifest already exists at ${manifestPath}`);
    const overwrite = await askQuestion('Overwrite existing manifest? [y/N] ');
    if (overwrite.toLowerCase() !== 'y') {
      log.info('Aborted. Existing manifest is unchanged.');
      return;
    }
  }

  // Interactive: collect roles
  log.info('Define team roles. Each role has an id, description, and resource namespaces.');
  log.info('Resource namespaces determine which subdirectories of skills/, knowledge/, learnings/ each role accesses.');
  log.info('');

  const roles: Array<{
    id: string;
    description: string;
    resources: { knowledge: string[]; skills: string[]; learnings: string[] };
  }> = [];

  let addMore = true;
  while (addMore) {
    const id = await askQuestion(`Role id (e.g. hai, pm, devops): `);
    if (!id) {
      log.warn('Role id is required. Skipping.');
      continue;
    }

    if (roles.some((r) => r.id === id)) {
      log.warn(`Role "${id}" already defined. Skipping.`);
      continue;
    }

    const description = await askQuestion(`Description for "${id}" (optional): `);

    const namespacesInput = await askQuestion(
      `Resource namespaces for "${id}" (comma-separated, e.g. common,${id}): `,
    );
    const namespaces = namespacesInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (namespaces.length === 0) {
      log.warn('At least one namespace is required. Using "common" as default.');
      namespaces.push('common');
    }

    roles.push({
      id,
      description,
      resources: {
        knowledge: namespaces,
        skills: namespaces,
        learnings: namespaces,
      },
    });

    log.success(`Added role: ${id} (namespaces: ${namespaces.join(', ')})`);

    const more = await askQuestion('Add another role? [y/N] ');
    addMore = more.toLowerCase() === 'y';
  }

  if (roles.length === 0) {
    log.error('No roles defined. Aborting.');
    return;
  }

  // Generate manifest YAML
  const manifest = {
    version: 1,
    roles,
    defaults: { shareTarget: 'primary-role' },
  };

  const yamlContent = YAML.stringify(manifest);

  if (options.dryRun) {
    log.info('[dry-run] Would write manifest:');
    console.log(yamlContent);
    return;
  }

  // Write manifest file
  await ensureDir(manifestDir);
  await writeFile(manifestPath, yamlContent);
  log.success(`Manifest written to ${manifestPath}`);

  // Show reminder about directory structure
  const allNamespaces = [...new Set(roles.flatMap((r) => r.resources.skills))];
  log.info('');
  log.info('Next step: organize your skills into namespace subdirectories:');
  for (const ns of allNamespaces) {
    log.info(`  skills/${ns}/`);
  }
  log.info('');
  log.info('Example: mv skills/hai-deploy-test skills/hai/hai-deploy-test');

  // Push via branch + PR
  const branchName = generateBranchName(localConfig.username);
  const commitMsg = `[teamai] Initialize roles manifest with ${roles.length} role(s)`;

  try {
    const hasChanges = await pushRepoBranch(
      repoPath,
      commitMsg,
      ['manifest/'],
      branchName,
    );

    if (!hasChanges) {
      log.info('No changes to push (manifest unchanged)');
      return;
    }

    log.success(`Pushed branch ${branchName}`);

    await createPrWithFallback(
      teamConfig,
      localConfig,
      branchName,
      commitMsg,
      `Initialize roles manifest:\n${roles.map((r) => `- ${r.id} (namespaces: ${r.resources.skills.join(', ')})`).join('\n')}`,
    );

    await checkoutMaster(repoPath);
  } catch (e) {
    log.error(`Push failed: ${(e as Error).message}`);
  }
}

// ─── roles list ─────────────────────────────────────────

export async function rolesList(options: GlobalOptions): Promise<void> {
  const { localConfig } = await autoDetectInit();
  const repoPath = localConfig.repo.localPath;

  let manifest;
  try {
    manifest = await loadRolesManifest(repoPath);
  } catch (e) {
    log.error((e as Error).message);
    log.info('Run `teamai roles init` to create a roles manifest.');
    return;
  }

  console.log('');
  console.log(`Roles manifest (version ${manifest.version}):`);
  console.log('');

  for (const role of manifest.roles) {
    const desc = role.description ? ` — ${role.description}` : '';
    console.log(`  ${role.id}${desc}`);
    console.log(`    skills:    ${role.resources.skills.join(', ')}`);
    console.log(`    knowledge: ${role.resources.knowledge.join(', ')}`);
    console.log(`    learnings: ${role.resources.learnings.join(', ')}`);
    console.log('');
  }

  // Show current user's role
  if (localConfig.primaryRole) {
    console.log(`Your primary role: ${localConfig.primaryRole}`);
    if (localConfig.additionalRoles && localConfig.additionalRoles.length > 0) {
      console.log(`Additional roles: ${localConfig.additionalRoles.join(', ')}`);
    }
  } else {
    console.log('You have no role configured. Run `teamai roles set <role>` to set one.');
  }
}

// ─── roles set ──────────────────────────────────────────

export async function rolesSet(
  primaryRole: string,
  options: GlobalOptions & { add?: string[] },
): Promise<void> {
  const { localConfig } = await autoDetectInit();
  const repoPath = localConfig.repo.localPath;

  let manifest;
  try {
    manifest = await loadRolesManifest(repoPath);
  } catch (e) {
    log.error((e as Error).message);
    log.info('Run `teamai roles init` to create a roles manifest first.');
    return;
  }

  const validIds = new Set(listRoleIds(manifest));

  // Validate primary role
  if (!validIds.has(primaryRole)) {
    log.error(`Unknown role "${primaryRole}". Valid roles: ${[...validIds].join(', ')}`);
    return;
  }

  // Validate additional roles
  const additionalRoles = (options.add ?? []).filter((id) => id !== primaryRole);
  for (const id of additionalRoles) {
    if (!validIds.has(id)) {
      log.error(`Unknown additional role "${id}". Valid roles: ${[...validIds].join(', ')}`);
      return;
    }
  }

  // Update local config
  const updatedConfig = {
    ...localConfig,
    primaryRole,
    additionalRoles,
    resourceProfileVersion: manifest.version,
  };

  if (localConfig.scope === 'project' && localConfig.projectRoot) {
    await saveLocalConfigForScope(updatedConfig, localConfig.scope, localConfig.projectRoot);
  } else {
    await saveLocalConfig(updatedConfig);
  }

  log.success(`Primary role set to: ${primaryRole}`);
  if (additionalRoles.length > 0) {
    log.success(`Additional roles: ${additionalRoles.join(', ')}`);
  }
  log.info('Run `teamai pull` to sync resources for your new role.');
}
