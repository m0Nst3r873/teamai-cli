import { z } from 'zod';

// ─── Tool path config ───────────────────────────────────

export const ToolPathsSchema = z.object({
  skills: z.string(),
  settings: z.string().optional(),
  claudemd: z.string().optional(),
});

// ─── Team config (teamai.yaml) ───────────────────────────

export const SharingConfigSchema = z.object({
  skills: z.object({
    syncTargets: z.array(z.string()).default(['claude', 'codex', 'claude-internal', 'cursor']),
  }).default({}),
  rules: z.object({
    enforced: z.array(z.string()).default([]),
  }).default({}),
  docs: z.object({
    localDir: z.string().default('~/.teamai/docs'),
  }).default({}),
});

export const TeamaiConfigSchema = z.object({
  team: z.string(),
  description: z.string().default(''),
  repo: z.string(),
  sharing: SharingConfigSchema.default({}),
  toolPaths: z.record(z.string(), ToolPathsSchema).default({
    claude: { skills: '.claude/skills', settings: '.claude/settings.json', claudemd: '.claude/CLAUDE.md' },
    codex: { skills: '.codex/skills' },
    'claude-internal': { skills: '.claude-internal/skills', settings: '.claude-internal/settings.json' },
    cursor: { skills: '.cursor/skills-cursor' },
  }),
});

export type TeamaiConfig = z.infer<typeof TeamaiConfigSchema>;

// ─── Member config (members/<user>.yaml) ────────────────

export const MemberRole = z.enum(['readonly', 'write']);
export type MemberRole = z.infer<typeof MemberRole>;

export const ROLE_TO_ACCESS_LEVEL: Record<MemberRole, number> = {
  readonly: 30,  // TGit Developer
  write: 40,     // TGit Master
};

export const MemberConfigSchema = z.object({
  username: z.string(),
  displayName: z.string().default(''),
  registeredAt: z.string(),
  role: MemberRole.default('readonly'),
});

export type MemberConfig = z.infer<typeof MemberConfigSchema>;

// ─── Local config (~/.teamai/config.yaml) ──────────────────

export const LocalConfigSchema = z.object({
  repo: z.object({
    localPath: z.string(),
    remote: z.string(),
  }),
  username: z.string(),
});

export type LocalConfig = z.infer<typeof LocalConfigSchema>;

// ─── Local state (~/.teamai/state.json) ────────────────────

export const StateSchema = z.object({
  lastPush: z.string().nullable().default(null),
  lastPull: z.string().nullable().default(null),
  pushedInstincts: z.array(z.string()).default([]),
  pushedRules: z.array(z.string()).default([]),
  pushedSkills: z.array(z.string()).default([]),
});

export type State = z.infer<typeof StateSchema>;

// ─── Resource types ─────────────────────────────────────

export type ResourceType = 'skills' | 'rules' | 'hooks' | 'docs' | 'instincts';

export interface ResourceItem {
  name: string;
  type: ResourceType;
  sourcePath: string;
  relativePath: string;
}

export interface ResourceDiff {
  added: ResourceItem[];
  modified: ResourceItem[];
  removed: ResourceItem[];
}

// ─── Global options ─────────────────────────────────────

export interface GlobalOptions {
  dryRun?: boolean;
  verbose?: boolean;
  silent?: boolean;
}

// ─── Constants ──────────────────────────────────────────

export const TEAMAI_HOME = `${process.env.HOME}/.teamai`;
export const TEAMAI_CONFIG_PATH = `${TEAMAI_HOME}/config.yaml`;
export const TEAMAI_STATE_PATH = `${TEAMAI_HOME}/state.json`;
export const TEAMAI_TOKEN_PATH = `${TEAMAI_HOME}/token`;

export const RESOURCE_TYPES: ResourceType[] = ['skills', 'rules', 'hooks', 'docs', 'instincts'];

export const TEAMAI_RULES_START = '<!-- [teamai:rules:start] -->';
export const TEAMAI_RULES_END = '<!-- [teamai:rules:end] -->';

export const TEAMAI_HOOK_DESCRIPTION_PREFIX = '[teamai]';
