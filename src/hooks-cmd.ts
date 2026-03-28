import path from 'node:path';
import { loadLocalConfig, loadTeamConfig } from './config.js';
import { injectHooksToAllTools, removeHooks } from './hooks.js';
import { log } from './utils/logger.js';
import type { GlobalOptions } from './types.js';

/**
 * Handler for `teamai hooks inject`.
 * Loads config and injects teamai hooks into all configured AI tool settings.
 */
export async function hooksInject(options: GlobalOptions): Promise<void> {
    const localConfig = await loadLocalConfig();
    if (!localConfig) {
        log.error('teamai is not initialized. Run `teamai init` first.');
        process.exit(1);
    }

    const teamConfig = await loadTeamConfig(localConfig.repo.localPath);
    if (!teamConfig) {
        log.error('Team config (teamai.yaml) not found. Check your repo path.');
        process.exit(1);
    }

    await injectHooksToAllTools(teamConfig.toolPaths);

    if (!options.silent) {
        log.success('Hooks injected into all AI tool settings');
    }
}

/**
 * Handler for `teamai hooks remove`.
 * Removes teamai hooks from all configured AI tool settings.
 */
export async function hooksRemove(_options: GlobalOptions): Promise<void> {
    const localConfig = await loadLocalConfig();
    if (!localConfig) {
        log.error('teamai is not initialized. Run `teamai init` first.');
        process.exit(1);
    }

    const teamConfig = await loadTeamConfig(localConfig.repo.localPath);
    if (!teamConfig) {
        log.error('Team config (teamai.yaml) not found. Check your repo path.');
        process.exit(1);
    }

    for (const [tool, paths] of Object.entries(teamConfig.toolPaths)) {
        if (paths.settings) {
            const settingsPath = path.join(process.env.HOME ?? '', paths.settings);
            try {
                await removeHooks(settingsPath, tool);
            } catch (e) {
                log.warn(`Failed to remove hooks from ${tool}: ${(e as Error).message}`);
            }
        }
    }

    log.success('Hooks removed from all AI tool settings');
}
