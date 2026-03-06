import path from 'node:path';
import YAML from 'yaml';
import { ResourceHandler } from './base.js';
import type { ResourceItem, TeamaiConfig, LocalConfig } from '../types.js';
import { pathExists, readFileSafe, readJson, writeJson } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import { TEAMAI_HOOK_DESCRIPTION_PREFIX } from '../types.js';

interface HookEntry {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
  description?: string;
}

interface HooksYaml {
  hooks: Record<string, HookMatcher[]>;
}

interface SettingsJson {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

export class HooksConfigHandler extends ResourceHandler {
  readonly type = 'hooks' as const;

  async scanLocalForPush(_teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<ResourceItem[]> {
    // Hooks are managed directly in team repo
    return [];
  }

  async scanTeamForPull(_teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const hooksYamlPath = path.join(localConfig.repo.localPath, 'hooks', 'hooks.yaml');
    if (!await pathExists(hooksYamlPath)) return [];

    return [{
      name: 'hooks.yaml',
      type: 'hooks',
      sourcePath: hooksYamlPath,
      relativePath: 'hooks/hooks.yaml',
    }];
  }

  async pushItem(_item: ResourceItem, _teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<void> {
    // No-op
  }

  /**
   * Merge team hooks from hooks.yaml into each AI tool's settings.json
   */
  async pullItem(item: ResourceItem, teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<void> {
    const content = await readFileSafe(item.sourcePath);
    if (!content) return;

    let hooksConfig: HooksYaml;
    try {
      hooksConfig = YAML.parse(content) as HooksYaml;
    } catch {
      log.warn('Invalid hooks.yaml format');
      return;
    }

    if (!hooksConfig?.hooks) return;

    for (const [tool, toolPath] of Object.entries(teamConfig.toolPaths)) {
      if (!toolPath.settings) continue;

      const settingsPath = path.join(process.env.HOME ?? '', toolPath.settings);
      const settings: SettingsJson = (await readJson<SettingsJson>(settingsPath)) ?? {};

      if (!settings.hooks) settings.hooks = {};

      let changed = false;

      for (const [event, matchers] of Object.entries(hooksConfig.hooks)) {
        if (!settings.hooks[event]) settings.hooks[event] = [];

        for (const matcher of matchers) {
          // Tag with teamai prefix for identification
          const description = matcher.description
            ? `${TEAMAI_HOOK_DESCRIPTION_PREFIX} ${matcher.description}`
            : `${TEAMAI_HOOK_DESCRIPTION_PREFIX} Team hook`;

          // Check if this exact hook already exists
          const exists = settings.hooks[event].some(
            (h) => h.description === description
          );

          if (!exists) {
            settings.hooks[event].push({ ...matcher, description });
            changed = true;
          }
        }
      }

      if (changed) {
        try {
          await writeJson(settingsPath, settings);
          log.debug(`Updated hooks in ${tool} settings.json`);
        } catch (e) {
          log.warn(`Failed to update ${tool} settings: ${(e as Error).message}`);
        }
      }
    }
  }

  /**
   * Count the number of hook entries defined in a hooks.yaml file.
   */
  async countHookEntries(sourcePath: string): Promise<number> {
    const content = await readFileSafe(sourcePath);
    if (!content) return 0;

    try {
      const hooksConfig = YAML.parse(content) as HooksYaml;
      if (!hooksConfig?.hooks) return 0;
      let count = 0;
      for (const matchers of Object.values(hooksConfig.hooks)) {
        count += matchers.length;
      }
      return count;
    } catch {
      return 0;
    }
  }

  async removeItem(_name: string, _teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<string[]> {
    log.warn('Removing hooks is not supported via remove command. Edit hooks/hooks.yaml directly.');
    return [];
  }
}
