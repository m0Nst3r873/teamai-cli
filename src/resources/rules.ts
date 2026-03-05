import path from 'node:path';
import { ResourceHandler } from './base.js';
import type { ResourceItem, TeamaiConfig, LocalConfig } from '../types.js';
import { listFiles, pathExists, readFileSafe, writeFile, copyFile } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import { TEAMAI_RULES_START, TEAMAI_RULES_END } from '../types.js';

export class RulesHandler extends ResourceHandler {
  readonly type = 'rules' as const;

  /**
   * Scan for local rule .md files that are not yet in the team repo.
   * Looks in each tool's CLAUDE.md sibling `rules/` directory (e.g. ~/.claude/rules/).
   */
  async scanLocalForPush(teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const teamRulesDir = path.join(localConfig.repo.localPath, 'rules');
    const teamRules = new Set(
      (await pathExists(teamRulesDir))
        ? (await listFiles(teamRulesDir)).filter((f) => f.endsWith('.md'))
        : [],
    );

    const items: ResourceItem[] = [];
    const seen = new Set<string>();

    // Scan each tool's directory for a sibling `rules/` folder
    for (const [_tool, toolPath] of Object.entries(teamConfig.toolPaths)) {
      if (!toolPath.claudemd) continue;
      const toolDir = path.join(process.env.HOME ?? '', path.dirname(toolPath.claudemd));
      const rulesDir = path.join(toolDir, 'rules');
      if (!await pathExists(rulesDir)) continue;

      const files = await listFiles(rulesDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        if (seen.has(file) || teamRules.has(file)) continue;

        seen.add(file);
        items.push({
          name: file.replace(/\.md$/, ''),
          type: 'rules',
          sourcePath: path.join(rulesDir, file),
          relativePath: `rules/${file}`,
        });
      }
    }

    // Also scan the team repo rules/ dir for untracked files (created directly)
    if (await pathExists(teamRulesDir)) {
      const repoFiles = await listFiles(teamRulesDir);
      for (const file of repoFiles) {
        if (!file.endsWith('.md')) continue;
        if (seen.has(file)) continue;
        // Check if this file is untracked by git (new, not yet committed)
        // We include all files here; pushRepo will handle the git add/commit
        seen.add(file);
      }
    }

    return items;
  }

  async scanTeamForPull(_teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const rulesDir = path.join(localConfig.repo.localPath, 'rules');
    if (!await pathExists(rulesDir)) return [];

    const files = await listFiles(rulesDir);
    return files
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({
        name: f.replace(/\.md$/, ''),
        type: 'rules' as const,
        sourcePath: path.join(rulesDir, f),
        relativePath: `rules/${f}`,
      }));
  }

  async pushItem(item: ResourceItem, _teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    const dest = path.join(localConfig.repo.localPath, 'rules', `${item.name}.md`);
    if (item.sourcePath !== dest) {
      await copyFile(item.sourcePath, dest);
    }
    log.debug(`Copied rule ${item.name} → team repo`);
  }

  /**
   * Pull rules from team repo and merge into CLAUDE.md files.
   * Uses marker comments to manage teamai-injected sections.
   */
  async pullItem(item: ResourceItem, teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<void> {
    // This is handled in bulk by pullAllRules
  }

  /**
   * Merge all rules into CLAUDE.md for each AI tool that has a claudemd path.
   */
  async pullAllRules(teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    const rules = await this.scanTeamForPull(teamConfig, localConfig);
    if (rules.length === 0) return;

    // Build the merged rules block
    const ruleContents: string[] = [];
    for (const rule of rules) {
      const content = await readFileSafe(rule.sourcePath);
      if (content) {
        ruleContents.push(`### ${rule.name}\n\n${content.trim()}`);
      }
    }

    const rulesBlock = [
      TEAMAI_RULES_START,
      '<!-- DO NOT EDIT: This section is auto-managed by teamai -->',
      '',
      '## Team Rules (teamai)',
      '',
      ruleContents.join('\n\n---\n\n'),
      '',
      TEAMAI_RULES_END,
    ].join('\n');

    // Inject into each tool's CLAUDE.md
    for (const [tool, toolPath] of Object.entries(teamConfig.toolPaths)) {
      if (!toolPath.claudemd) continue;

      const claudeMdPath = path.join(process.env.HOME ?? '', toolPath.claudemd);

      let existing = await readFileSafe(claudeMdPath) ?? '';

      // Replace existing teamai rules block or append
      const startIdx = existing.indexOf(TEAMAI_RULES_START);
      const endIdx = existing.indexOf(TEAMAI_RULES_END);

      if (startIdx !== -1 && endIdx !== -1) {
        existing = existing.substring(0, startIdx) + rulesBlock + existing.substring(endIdx + TEAMAI_RULES_END.length);
      } else {
        existing = existing.trimEnd() + '\n\n' + rulesBlock + '\n';
      }

      try {
        await writeFile(claudeMdPath, existing);
        log.debug(`Updated rules in ${tool} CLAUDE.md`);
      } catch (e) {
        log.warn(`Failed to update ${tool} CLAUDE.md: ${(e as Error).message}`);
      }
    }
  }
}
