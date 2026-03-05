import path from 'node:path';
import { loadLocalConfig, loadTeamConfig } from './config.js';
import { pathExists } from './utils/fs.js';
import { log } from './utils/logger.js';
import type { GlobalOptions } from './types.js';

interface Check {
  name: string;
  check: () => Promise<boolean>;
  fix?: string;
}

export async function doctor(options: GlobalOptions): Promise<void> {
  log.info('Running diagnostics...\n');
  const localConfig = await loadLocalConfig();

  const checks: Check[] = [
    {
      name: 'TGIT_TOKEN is set',
      check: async () => !!process.env.TGIT_TOKEN,
      fix: 'Set TGIT_TOKEN env var. Get a token from https://git.woa.com/profile/account',
    },
    {
      name: 'Local config exists (~/.teamai/config.yaml)',
      check: async () => localConfig !== null,
      fix: 'Run `teamai init` to initialize',
    },
    {
      name: 'Team repo exists locally',
      check: async () => {
        if (!localConfig) return false;
        return pathExists(localConfig.repo.localPath);
      },
      fix: 'Run `teamai init` to clone the team repo',
    },
    {
      name: 'Team config (teamai.yaml) is valid',
      check: async () => {
        if (!localConfig) return false;
        const config = await loadTeamConfig(localConfig.repo.localPath);
        return config !== null;
      },
      fix: 'Check teamai.yaml in team repo for syntax errors',
    },
    {
      name: 'teamai hook in claude settings',
      check: async () => {
        const settingsPath = path.join(process.env.HOME ?? '', '.claude', 'settings.json');
        if (!await pathExists(settingsPath)) return false;
        const { readFileSafe } = await import('./utils/fs.js');
        const content = await readFileSafe(settingsPath);
        return content?.includes('[teamai]') ?? false;
      },
      fix: 'Run `teamai init` to inject hooks',
    },
  ];

  let allPassed = true;
  for (const { name, check, fix } of checks) {
    const ok = await check();
    if (ok) {
      console.log(`  ✔ ${name}`);
    } else {
      console.log(`  ✖ ${name}`);
      if (fix) console.log(`    → ${fix}`);
      allPassed = false;
    }
  }

  console.log('');
  if (allPassed) {
    log.success('All checks passed!');
  } else {
    log.warn('Some checks failed. See suggestions above.');
  }
}
