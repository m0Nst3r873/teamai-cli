import path from 'node:path';
import { readJson, writeJson, expandHome, ensureDir } from './utils/fs.js';
import { log } from './utils/logger.js';
import { TEAMAI_HOOK_DESCRIPTION_PREFIX } from './types.js';

const TEAMAI_PULL_COMMAND = 'bash -lc "teamai pull" 2>/dev/null || true';

// ─── Claude Code / Claude Internal format (settings.json) ───

interface HookEntry {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
  description?: string;
}

interface ClaudeSettingsJson {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

const CLAUDE_SESSION_START_HOOK: HookMatcher = {
  matcher: '*',
  hooks: [{ type: 'command', command: TEAMAI_PULL_COMMAND }],
  description: `${TEAMAI_HOOK_DESCRIPTION_PREFIX} Auto-pull team resources on session start`,
};

// ─── Cursor format (hooks.json) ─────────────────────────────

interface CursorHookEntry {
  command: string;
  timeout?: number;
}

interface CursorHooksJson {
  version: number;
  hooks: Record<string, CursorHookEntry[]>;
}

const CURSOR_SESSION_START_HOOK: CursorHookEntry = {
  command: TEAMAI_PULL_COMMAND,
  timeout: 30,
};

// ─── Tool format detection ──────────────────────────────────

type ToolFormat = 'claude' | 'cursor';

const CURSOR_TOOLS = new Set(['cursor']);

function detectFormat(tool: string): ToolFormat {
  return CURSOR_TOOLS.has(tool) ? 'cursor' : 'claude';
}

// ─── Claude Code hooks injection ────────────────────────────

async function injectClaudeHooks(settingsPath: string): Promise<void> {
  const expanded = expandHome(settingsPath);
  await ensureDir(path.dirname(expanded));
  const settings: ClaudeSettingsJson = (await readJson<ClaudeSettingsJson>(expanded)) ?? {};

  if (!settings.hooks) {
    settings.hooks = {};
  }
  if (!settings.hooks.SessionStart) {
    settings.hooks.SessionStart = [];
  }

  const existing = settings.hooks.SessionStart.find(
    (h) => h.description?.startsWith(TEAMAI_HOOK_DESCRIPTION_PREFIX)
  );
  if (existing) {
    // Update command if it changed (e.g. --silent removed)
    const currentCmd = existing.hooks?.[0]?.command;
    if (currentCmd !== TEAMAI_PULL_COMMAND) {
      existing.hooks = CLAUDE_SESSION_START_HOOK.hooks;
      await writeJson(expanded, settings);
      log.success(`Updated teamai hook in ${settingsPath}`);
    } else {
      log.debug(`teamai hook already exists in ${settingsPath}`);
    }
    return;
  }

  settings.hooks.SessionStart.push(CLAUDE_SESSION_START_HOOK);
  await writeJson(expanded, settings);
  log.success(`Injected teamai hook into ${settingsPath}`);
}

async function removeClaudeHooks(settingsPath: string): Promise<void> {
  const expanded = expandHome(settingsPath);
  const settings = await readJson<ClaudeSettingsJson>(expanded);
  if (!settings?.hooks) return;

  let changed = false;
  for (const [event, matchers] of Object.entries(settings.hooks)) {
    const filtered = matchers.filter(
      (h) => !h.description?.startsWith(TEAMAI_HOOK_DESCRIPTION_PREFIX)
    );
    if (filtered.length !== matchers.length) {
      settings.hooks[event] = filtered;
      changed = true;
    }
  }

  if (changed) {
    await writeJson(expanded, settings);
    log.success(`Removed teamai hooks from ${settingsPath}`);
  }
}

// ─── Cursor hooks injection ─────────────────────────────────

async function injectCursorHooks(hooksPath: string): Promise<void> {
  const expanded = expandHome(hooksPath);
  await ensureDir(path.dirname(expanded));
  const hooksJson: CursorHooksJson = (await readJson<CursorHooksJson>(expanded)) ?? {
    version: 1,
    hooks: {},
  };

  if (!hooksJson.version) {
    hooksJson.version = 1;
  }
  if (!hooksJson.hooks) {
    hooksJson.hooks = {};
  }
  if (!hooksJson.hooks.sessionStart) {
    hooksJson.hooks.sessionStart = [];
  }

  // Check if teamai hook already exists (match by command prefix)
  const existingIdx = hooksJson.hooks.sessionStart.findIndex(
    (h) => h.command.includes('teamai pull')
  );
  if (existingIdx >= 0) {
    const existing = hooksJson.hooks.sessionStart[existingIdx];
    if (existing.command !== TEAMAI_PULL_COMMAND) {
      hooksJson.hooks.sessionStart[existingIdx] = CURSOR_SESSION_START_HOOK;
      await writeJson(expanded, hooksJson);
      log.success(`Updated teamai hook in ${hooksPath}`);
    } else {
      log.debug(`teamai hook already exists in ${hooksPath}`);
    }
    return;
  }

  hooksJson.hooks.sessionStart.push(CURSOR_SESSION_START_HOOK);
  await writeJson(expanded, hooksJson);
  log.success(`Injected teamai hook into ${hooksPath}`);
}

async function removeCursorHooks(hooksPath: string): Promise<void> {
  const expanded = expandHome(hooksPath);
  const hooksJson = await readJson<CursorHooksJson>(expanded);
  if (!hooksJson?.hooks) return;

  let changed = false;
  for (const [event, entries] of Object.entries(hooksJson.hooks)) {
    const filtered = entries.filter((h) => h.command !== TEAMAI_PULL_COMMAND);
    if (filtered.length !== entries.length) {
      hooksJson.hooks[event] = filtered;
      changed = true;
    }
  }

  if (changed) {
    await writeJson(expanded, hooksJson);
    log.success(`Removed teamai hooks from ${hooksPath}`);
  }
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Inject teamai hooks into a tool's settings/hooks file
 */
export async function injectHooks(settingsPath: string, tool?: string): Promise<void> {
  const format = detectFormat(tool ?? '');
  if (format === 'cursor') {
    await injectCursorHooks(settingsPath);
  } else {
    await injectClaudeHooks(settingsPath);
  }
}

/**
 * Remove teamai hooks from a tool's settings/hooks file
 */
export async function removeHooks(settingsPath: string, tool?: string): Promise<void> {
  const format = detectFormat(tool ?? '');
  if (format === 'cursor') {
    await removeCursorHooks(settingsPath);
  } else {
    await removeClaudeHooks(settingsPath);
  }
}

/**
 * Inject teamai hooks into all AI tool settings
 */
export async function injectHooksToAllTools(toolPaths: Record<string, { settings?: string }>): Promise<void> {
  for (const [tool, paths] of Object.entries(toolPaths)) {
    if (paths.settings) {
      const settingsPath = path.join(process.env.HOME ?? '', paths.settings);
      try {
        await injectHooks(settingsPath, tool);
      } catch (e) {
        log.warn(`Failed to inject hook into ${tool}: ${(e as Error).message}`);
      }
    }
  }
}
