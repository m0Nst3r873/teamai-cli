import path from 'node:path';
import { ResourceHandler } from './base.js';
import type { ResourceItem, TeamaiConfig, LocalConfig } from '../types.js';
import { listDirs, listFiles, pathExists, copyDir, copyFile, expandHome } from '../utils/fs.js';
import { log } from '../utils/logger.js';

const HOMUNCULUS_DIR = '.claude/homunculus';

export class InstinctsHandler extends ResourceHandler {
  readonly type = 'instincts' as const;

  /**
   * Scan CL-v2 homunculus instincts for items to push.
   */
  async scanLocalForPush(teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const home = process.env.HOME ?? '';
    const instinctsDir = path.join(home, HOMUNCULUS_DIR, 'instincts', 'personal');
    const teamInstinctsDir = path.join(localConfig.repo.localPath, 'instincts', localConfig.username);

    const items: ResourceItem[] = [];

    if (!await pathExists(instinctsDir)) return items;

    const files = await listFiles(instinctsDir);
    const teamFiles = new Set(await pathExists(teamInstinctsDir) ? await listFiles(teamInstinctsDir) : []);

    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml') && !file.endsWith('.md')) continue;
      if (teamFiles.has(file)) continue;

      items.push({
        name: file.replace(/\.(yaml|yml|md)$/, ''),
        type: 'instincts',
        sourcePath: path.join(instinctsDir, file),
        relativePath: `instincts/${localConfig.username}/${file}`,
      });
    }

    // Also scan project-scoped instincts
    const projectsDir = path.join(home, HOMUNCULUS_DIR, 'projects');
    if (await pathExists(projectsDir)) {
      const projectHashes = await listDirs(projectsDir);
      for (const hash of projectHashes) {
        const projectInstincts = path.join(projectsDir, hash, 'instincts', 'personal');
        if (!await pathExists(projectInstincts)) continue;

        const pFiles = await listFiles(projectInstincts);
        for (const file of pFiles) {
          if (!file.endsWith('.yaml') && !file.endsWith('.yml') && !file.endsWith('.md')) continue;
          const name = `${hash}/${file.replace(/\.(yaml|yml|md)$/, '')}`;
          if (teamFiles.has(file)) continue;

          items.push({
            name,
            type: 'instincts',
            sourcePath: path.join(projectInstincts, file),
            relativePath: `instincts/${localConfig.username}/${file}`,
          });
        }
      }
    }

    return items;
  }

  /**
   * Scan team repo for instincts to pull (from all members).
   */
  async scanTeamForPull(teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const teamInstinctsDir = path.join(localConfig.repo.localPath, 'instincts');
    const items: ResourceItem[] = [];

    if (!await pathExists(teamInstinctsDir)) return items;

    const memberDirs = await listDirs(teamInstinctsDir);
    for (const member of memberDirs) {
      const memberDir = path.join(teamInstinctsDir, member);
      const files = await listFiles(memberDir);
      for (const file of files) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml') && !file.endsWith('.md')) continue;
        items.push({
          name: `${member}/${file.replace(/\.(yaml|yml|md)$/, '')}`,
          type: 'instincts',
          sourcePath: path.join(memberDir, file),
          relativePath: `instincts/${member}/${file}`,
        });
      }
    }

    return items;
  }

  /**
   * Copy a local instinct to the team repo under the user's directory.
   */
  async pushItem(item: ResourceItem, _teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    const dest = path.join(localConfig.repo.localPath, item.relativePath);
    await copyFile(item.sourcePath, dest);
    log.debug(`Copied instinct ${item.name} → team repo`);
  }

  /**
   * Pull instincts from team repo to CL-v2 inherited directory.
   */
  async pullItem(item: ResourceItem, _teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<void> {
    const home = process.env.HOME ?? '';
    const inheritedDir = path.join(home, HOMUNCULUS_DIR, 'instincts', 'inherited');

    // Only import to inherited if homunculus dir exists (CL-v2 installed)
    if (!await pathExists(path.join(home, HOMUNCULUS_DIR))) {
      log.debug('CL-v2 not installed, skipping instinct import');
      return;
    }

    const filename = path.basename(item.sourcePath);
    const dest = path.join(inheritedDir, filename);
    try {
      await copyFile(item.sourcePath, dest);
      log.debug(`Imported instinct ${item.name} → inherited/`);
    } catch (e) {
      log.warn(`Failed to import instinct ${item.name}: ${(e as Error).message}`);
    }
  }

  async removeItem(_name: string, _teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<string[]> {
    log.warn('Removing instincts is not supported');
    return [];
  }
}
