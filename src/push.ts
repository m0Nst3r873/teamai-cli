import readline from 'node:readline';
import { requireInit, loadState, saveState } from './config.js';
import { pushRepo } from './utils/git.js';
import { log, spinner } from './utils/logger.js';
import { getHandler } from './resources/index.js';
import type { GlobalOptions, ResourceItem, ResourceType } from './types.js';

function askConfirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${prompt} [Y/n] `, (answer) => {
      rl.close();
      resolve(!answer || answer.toLowerCase() === 'y');
    });
  });
}

export async function push(options: GlobalOptions & { all?: boolean }): Promise<void> {
  const { localConfig, teamConfig } = await requireInit();

  const spin = spinner('Scanning local resources...').start();

  // Scan for pushable resources
  const pushableTypes: ResourceType[] = ['skills', 'rules', 'instincts'];
  const allItems: ResourceItem[] = [];

  for (const type of pushableTypes) {
    const handler = getHandler(type);
    const items = await handler.scanLocalForPush(teamConfig, localConfig);
    allItems.push(...items);
  }

  spin.stop();

  if (allItems.length === 0) {
    log.info('No new resources to push');
    return;
  }

  // Display items
  console.log('');
  console.log(`Found ${allItems.length} new resource(s) to push:`);
  console.log('');
  for (const item of allItems) {
    console.log(`  [${item.type}] ${item.name}`);
    if (options.verbose) {
      console.log(`    from: ${item.sourcePath}`);
    }
  }
  console.log('');

  if (options.dryRun) {
    log.info('Dry run — no changes made');
    return;
  }

  // Confirm
  if (!options.all && !options.silent) {
    const confirmed = await askConfirm('Push these resources to team repo?');
    if (!confirmed) {
      log.info('Cancelled');
      return;
    }
  }

  // Push each item
  const pushSpin = spinner('Pushing resources...').start();
  const pushedFiles: string[] = [];

  for (const item of allItems) {
    const handler = getHandler(item.type);
    await handler.pushItem(item, teamConfig, localConfig);
    pushedFiles.push(item.relativePath);
  }

  // Git commit and push
  try {
    // Add all files under the resource directories
    const gitFiles = ['skills/', 'rules/', 'instincts/'];
    await pushRepo(
      localConfig.repo.localPath,
      `[teamai] Push ${allItems.length} resource(s) from ${localConfig.username}`,
      gitFiles,
    );
    pushSpin.succeed(`Pushed ${allItems.length} resource(s) to team repo`);
  } catch (e) {
    pushSpin.fail(`Push failed: ${(e as Error).message}`);
    return;
  }

  // Update state
  const state = await loadState();
  state.lastPush = new Date().toISOString();
  for (const item of allItems) {
    if (item.type === 'skills' && !state.pushedSkills.includes(item.name)) {
      state.pushedSkills.push(item.name);
    }
    if (item.type === 'instincts' && !state.pushedInstincts.includes(item.name)) {
      state.pushedInstincts.push(item.name);
    }
    if (item.type === 'rules' && !state.pushedRules.includes(item.name)) {
      state.pushedRules.push(item.name);
    }
  }
  await saveState(state);
}
