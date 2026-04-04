import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ─── Test helpers ──────────────────────────────────────────

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-builtin-rules-'));
}

describe('builtin-rules', () => {
    let tmpDir: string;
    let originalHome: string;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        originalHome = process.env.HOME ?? '';
        process.env.HOME = tmpDir;
    });

    afterEach(() => {
        process.env.HOME = originalHome;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('deployBuiltinRules', () => {
        it('should clean up legacy teamai-recall.md files', async () => {
            // Arrange: create tool rules directories with legacy rule
            const claudeRulesDir = path.join(tmpDir, '.claude', 'rules');
            fs.mkdirSync(claudeRulesDir, { recursive: true });
            fs.writeFileSync(path.join(claudeRulesDir, 'teamai-recall.md'), 'old recall rule', 'utf-8');

            const teamConfig = {
                toolPaths: {
                    claude: {
                        skills: '.claude/skills',
                        rules: '.claude/rules',
                        settings: '.claude/settings.json',
                        claudemd: '.claude/CLAUDE.md',
                    },
                },
            } as any;

            // Act
            const { deployBuiltinRules } = await import('../builtin-rules.js');
            await deployBuiltinRules(teamConfig);

            // Assert: legacy file is removed
            expect(fs.existsSync(path.join(claudeRulesDir, 'teamai-recall.md'))).toBe(false);
        });

        it('should skip tool directories that do not exist (tool not installed)', async () => {
            // Arrange: only create one tool directory
            const claudeRulesDir = path.join(tmpDir, '.claude', 'rules');
            fs.mkdirSync(claudeRulesDir, { recursive: true });
            // Do NOT create .cursor/rules/

            const teamConfig = {
                toolPaths: {
                    claude: {
                        skills: '.claude/skills',
                        rules: '.claude/rules',
                        settings: '.claude/settings.json',
                        claudemd: '.claude/CLAUDE.md',
                    },
                    cursor: {
                        skills: '.cursor/skills',
                        rules: '.cursor/rules',
                        settings: '.cursor/settings.json',
                        claudemd: '.cursor/CLAUDE.md',
                    },
                },
            } as any;

            // Act
            const { deployBuiltinRules } = await import('../builtin-rules.js');
            const deployed = await deployBuiltinRules(teamConfig);

            // Assert: only claude dir processed
            expect(deployed).toBe(1);
        });

        it('should not fail when legacy file does not exist', async () => {
            // Arrange: create tool dir without legacy file
            const claudeRulesDir = path.join(tmpDir, '.claude', 'rules');
            fs.mkdirSync(claudeRulesDir, { recursive: true });

            const teamConfig = {
                toolPaths: {
                    claude: {
                        rules: '.claude/rules',
                        claudemd: '.claude/CLAUDE.md',
                    },
                },
            } as any;

            // Act & Assert: should not throw
            const { deployBuiltinRules } = await import('../builtin-rules.js');
            const deployed = await deployBuiltinRules(teamConfig);
            expect(deployed).toBe(1);
        });
    });

    describe('BUILTIN_RULE_NAMES', () => {
        it('should be empty (no built-in rules deployed after recall rule removal)', async () => {
            const { BUILTIN_RULE_NAMES } = await import('../builtin-rules.js');
            expect(BUILTIN_RULE_NAMES.size).toBe(0);
        });
    });
});
