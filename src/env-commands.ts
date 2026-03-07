import path from 'node:path';
import YAML from 'yaml';
import { requireInit } from './config.js';
import { pullRepo, pushRepoBranch, generateBranchName } from './utils/git.js';
import { gfMrCreate } from './utils/gf-cli.js';
import { parseRepoInput } from './utils/repo-url.js';
import { ensureDir, readFileSafe, writeFile, pathExists } from './utils/fs.js';
import { log, spinner } from './utils/logger.js';
import { EnvHandler } from './resources/env.js';
import type { GlobalOptions } from './types.js';

const envHandler = new EnvHandler();

/**
 * List all team env variables from env.yaml.
 */
export async function envList(options: GlobalOptions): Promise<void> {
  const { localConfig } = await requireInit();
  const envYamlPath = path.join(localConfig.repo.localPath, 'env', 'env.yaml');

  if (!await pathExists(envYamlPath)) {
    log.info('No env variables defined (env/env.yaml not found)');
    return;
  }

  const envConfig = await envHandler.parseEnvYaml(envYamlPath);
  if (envConfig.variables.length === 0) {
    log.info('No env variables defined');
    return;
  }

  console.log('');
  console.log(`Team env variables (${envConfig.variables.length}):`);
  console.log('');
  for (const v of envConfig.variables) {
    console.log(`  ${v.key}=${v.value}`);
    if (v.description && options.verbose) {
      log.dim(`    ${v.description}`);
    }
  }
  console.log('');
}

/**
 * Helper: create MR via gf CLI for env changes.
 */
async function createEnvMr(
  repoPath: string,
  branchName: string,
  commitMsg: string,
  description: string,
  teamConfig: { repo: string; reviewers?: string[] },
  localConfig: { repo: { remote: string } },
): Promise<void> {
  const hasChanges = await pushRepoBranch(repoPath, commitMsg, ['env/'], branchName);
  if (!hasChanges) {
    log.success('No changes (variable already up to date)');
    return;
  }
  log.success(`Pushed branch ${branchName}`);

  const mrSpin = spinner('Creating Merge Request...').start();
  try {
    let repoInfo;
    try {
      repoInfo = parseRepoInput(teamConfig.repo);
    } catch {
      repoInfo = parseRepoInput(localConfig.repo.remote);
    }

    const mrUrl = gfMrCreate({
      repo: `${repoInfo.owner}/${repoInfo.repo}`,
      source: branchName,
      target: 'master',
      title: commitMsg,
      description,
      reviewers: teamConfig.reviewers?.length ? teamConfig.reviewers : undefined,
    });
    mrSpin.succeed(`Merge Request created: ${mrUrl}`);
  } catch (e) {
    mrSpin.fail(`Failed to create MR: ${(e as Error).message}`);
    log.info(`Branch ${branchName} has been pushed. You can create a MR manually.`);
  }
}

/**
 * Add or update an env variable via branch + MR.
 */
export async function envAdd(
  key: string,
  value: string,
  options: GlobalOptions & { description?: string },
): Promise<void> {
  const { localConfig, teamConfig } = await requireInit();
  const repoPath = localConfig.repo.localPath;
  const envYamlPath = path.join(repoPath, 'env', 'env.yaml');

  // Pull latest
  const pullSpin = spinner('Pulling latest...').start();
  try {
    await pullRepo(repoPath);
    pullSpin.succeed('Up to date');
  } catch (e) {
    pullSpin.warn(`Pull failed: ${(e as Error).message}`);
  }

  // Parse existing env.yaml (or create new)
  const envConfig = await envHandler.parseEnvYaml(envYamlPath);

  // Check if key already exists
  const existingIdx = envConfig.variables.findIndex(v => v.key === key);
  const isUpdate = existingIdx !== -1;

  if (isUpdate) {
    envConfig.variables[existingIdx].value = value;
    if (options.description) {
      envConfig.variables[existingIdx].description = options.description;
    }
  } else {
    const newVar: { key: string; value: string; description?: string } = { key, value };
    if (options.description) {
      newVar.description = options.description;
    }
    envConfig.variables.push(newVar);
  }

  if (options.dryRun) {
    log.info(`[dry-run] Would ${isUpdate ? 'update' : 'add'} env variable: ${key}=${value}`);
    return;
  }

  // Write updated env.yaml
  await ensureDir(path.join(repoPath, 'env'));
  await envHandler.writeEnvYaml(envYamlPath, envConfig);

  // Create branch + MR
  const action = isUpdate ? 'Update' : 'Add';
  const branchName = generateBranchName(localConfig.username);
  const commitMsg = `[teamai] ${action} env variable: ${key}`;

  const pushSpin = spinner('Creating branch and MR...').start();
  try {
    await createEnvMr(
      repoPath,
      branchName,
      commitMsg,
      `${action} env variable:\n- \`${key}=${value}\`${options.description ? `\n- Description: ${options.description}` : ''}`,
      teamConfig,
      localConfig,
    );
    pushSpin.stop();
  } catch (e) {
    pushSpin.fail(`Push failed: ${(e as Error).message}`);
  }
}

/**
 * Remove an env variable via branch + MR.
 */
export async function envRemove(key: string, options: GlobalOptions): Promise<void> {
  const { localConfig, teamConfig } = await requireInit();
  const repoPath = localConfig.repo.localPath;
  const envYamlPath = path.join(repoPath, 'env', 'env.yaml');

  // Pull latest
  const pullSpin = spinner('Pulling latest...').start();
  try {
    await pullRepo(repoPath);
    pullSpin.succeed('Up to date');
  } catch (e) {
    pullSpin.warn(`Pull failed: ${(e as Error).message}`);
  }

  if (!await pathExists(envYamlPath)) {
    log.error('No env variables defined (env/env.yaml not found)');
    return;
  }

  const envConfig = await envHandler.parseEnvYaml(envYamlPath);
  const idx = envConfig.variables.findIndex(v => v.key === key);

  if (idx === -1) {
    log.error(`Env variable "${key}" not found`);
    return;
  }

  if (options.dryRun) {
    log.info(`[dry-run] Would remove env variable: ${key}`);
    return;
  }

  envConfig.variables.splice(idx, 1);
  await envHandler.writeEnvYaml(envYamlPath, envConfig);

  // Create branch + MR
  const branchName = generateBranchName(localConfig.username);
  const commitMsg = `[teamai] Remove env variable: ${key}`;

  const pushSpin = spinner('Creating branch and MR...').start();
  try {
    await createEnvMr(
      repoPath,
      branchName,
      commitMsg,
      `Remove env variable: \`${key}\``,
      teamConfig,
      localConfig,
    );
    pushSpin.stop();
  } catch (e) {
    pushSpin.fail(`Push failed: ${(e as Error).message}`);
  }
}
