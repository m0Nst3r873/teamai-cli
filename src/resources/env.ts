import path from 'node:path';
import { z } from 'zod';
import YAML from 'yaml';
import { ResourceHandler } from './base.js';
import type { ResourceItem, TeamaiConfig, LocalConfig } from '../types.js';
import { TEAMAI_ENV_START, TEAMAI_ENV_END } from '../types.js';
import { pathExists, readFileSafe, writeFile, ensureDir } from '../utils/fs.js';
import { log } from '../utils/logger.js';

// ─── Schema for env.yaml ────────────────────────────────

const EnvVariableSchema = z.object({
  key: z.string(),
  value: z.string(),
  description: z.string().optional(),
});

const EnvYamlSchema = z.object({
  variables: z.array(EnvVariableSchema).default([]),
});

export type EnvVariable = z.infer<typeof EnvVariableSchema>;
export type EnvYaml = z.infer<typeof EnvYamlSchema>;

// ─── Handler ─────────────────────────────────────────────

export class EnvHandler extends ResourceHandler {
  readonly type = 'env' as const;

  /**
   * Env vars are managed via dedicated CLI commands, not auto-scanned for push.
   */
  async scanLocalForPush(_teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<ResourceItem[]> {
    return [];
  }

  async scanTeamForPull(_teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const envYamlPath = path.join(localConfig.repo.localPath, 'env', 'env.yaml');
    if (!await pathExists(envYamlPath)) return [];

    return [{
      name: 'env.yaml',
      type: 'env',
      sourcePath: envYamlPath,
      relativePath: 'env/env.yaml',
    }];
  }

  async pushItem(_item: ResourceItem, _teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<void> {
    // No-op — env is managed via dedicated CLI commands
  }

  /**
   * Pull env variables: parse env.yaml, write backup, inject into shell profile.
   */
  async pullItem(item: ResourceItem, teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<void> {
    const content = await readFileSafe(item.sourcePath);
    if (!content) return;

    let envConfig: EnvYaml;
    try {
      const raw = YAML.parse(content);
      envConfig = EnvYamlSchema.parse(raw);
    } catch (e) {
      log.warn(`Invalid env.yaml format: ${(e as Error).message}`);
      return;
    }

    if (envConfig.variables.length === 0) return;

    // Write backup to ~/.teamai/env (KEY=VALUE format, for loadEnvFile compatibility)
    const home = process.env.HOME ?? '';
    const teamaiHome = path.join(home, '.teamai');
    const backupLines = envConfig.variables.map(v => `${v.key}=${v.value}`);
    await ensureDir(teamaiHome);
    await writeFile(path.join(teamaiHome, 'env'), backupLines.join('\n') + '\n');

    // Inject into shell profile if enabled
    const inject = teamConfig.sharing.env.injectShellProfile !== false;

    if (inject) {
      const profilePath = teamConfig.sharing.env.shellProfilePath
        ? teamConfig.sharing.env.shellProfilePath
        : this.detectShellProfile();

      const shellBlock = this.generateShellBlock(envConfig.variables);
      await this.injectShellProfile(profilePath, shellBlock);
    }
  }

  /**
   * Count the number of env variables in env.yaml.
   */
  async countEnvVars(sourcePath: string): Promise<number> {
    const content = await readFileSafe(sourcePath);
    if (!content) return 0;

    try {
      const raw = YAML.parse(content);
      const envConfig = EnvYamlSchema.parse(raw);
      return envConfig.variables.length;
    } catch {
      return 0;
    }
  }

  /**
   * Parse the env.yaml file and return variables.
   */
  async parseEnvYaml(filePath: string): Promise<EnvYaml> {
    const content = await readFileSafe(filePath);
    if (!content) return { variables: [] };

    try {
      const raw = YAML.parse(content);
      return EnvYamlSchema.parse(raw);
    } catch {
      return { variables: [] };
    }
  }

  /**
   * Write env.yaml with the given variables.
   */
  async writeEnvYaml(filePath: string, envConfig: EnvYaml): Promise<void> {
    await ensureDir(path.dirname(filePath));
    await writeFile(filePath, YAML.stringify(envConfig));
  }

  /**
   * Generate the shell block with export statements wrapped in markers.
   */
  generateShellBlock(variables: EnvVariable[]): string {
    const lines = [
      TEAMAI_ENV_START,
      '# DO NOT EDIT: This section is auto-managed by teamai',
      ...variables.map(v => `export ${v.key}="${v.value}"`),
      TEAMAI_ENV_END,
    ];
    return lines.join('\n');
  }

  /**
   * Detect the user's shell profile path.
   */
  private detectShellProfile(): string {
    const home = process.env.HOME ?? '';
    const shell = process.env.SHELL ?? '';

    if (shell.includes('zsh')) {
      return path.join(home, '.zshrc');
    }
    return path.join(home, '.bashrc');
  }

  /**
   * Inject the shell block into the profile file (idempotent).
   */
  private async injectShellProfile(profilePath: string, block: string): Promise<void> {
    let content = await readFileSafe(profilePath) ?? '';

    const startIdx = content.indexOf(TEAMAI_ENV_START);
    const endIdx = content.indexOf(TEAMAI_ENV_END);

    if (startIdx !== -1 && endIdx !== -1) {
      // Replace existing block
      const before = content.substring(0, startIdx);
      const after = content.substring(endIdx + TEAMAI_ENV_END.length);
      content = before + block + after;
    } else {
      // Append block
      if (content.length > 0 && !content.endsWith('\n')) {
        content += '\n';
      }
      content += '\n' + block + '\n';
    }

    await writeFile(profilePath, content);
  }

  async removeItem(_name: string, _teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<string[]> {
    log.warn('Use `teamai env remove <key>` to manage env variables.');
    return [];
  }
}
