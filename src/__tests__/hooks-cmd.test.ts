import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ── Mocks ────────────────────────────────────────────────

vi.mock('../config.js', () => ({
    autoDetectInit: vi.fn(),
}));

vi.mock('../hooks.js', () => ({
    injectHooksToAllTools: vi.fn(),
    removeHooks: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
    log: {
        info: vi.fn(),
        success: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// ── Imports (after mocks) ────────────────────────────────

import { autoDetectInit } from '../config.js';
import { injectHooksToAllTools, removeHooks } from '../hooks.js';
import { log } from '../utils/logger.js';
import { hooksInject, hooksRemove } from '../hooks-cmd.js';

const mockedAutoDetectInit = autoDetectInit as Mock;
const mockedInjectHooksToAllTools = injectHooksToAllTools as Mock;
const mockedRemoveHooks = removeHooks as Mock;
const mockedLog = log as unknown as {
    info: Mock;
    success: Mock;
    warn: Mock;
    error: Mock;
    debug: Mock;
};

const mockLocalConfig = {
    repo: { localPath: '/tmp/repo', remote: 'https://git.woa.com/team/repo.git' },
    username: 'testuser',
    updatePolicy: 'auto',
    scope: 'user',
};

const mockTeamConfig = {
    toolPaths: {
        claude: { settings: '.claude/settings.json', skills: '.claude/skills' },
        'claude-internal': { settings: '.claude-internal/settings.json', skills: '.claude-internal/skills' },
        cursor: { settings: '.cursor/hooks.json', skills: '.cursor/skills' },
    },
};

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    mockedAutoDetectInit.mockResolvedValue({ localConfig: mockLocalConfig, teamConfig: mockTeamConfig });
    mockedInjectHooksToAllTools.mockResolvedValue(undefined);
    mockedRemoveHooks.mockResolvedValue(undefined);
});

// ── Tests ────────────────────────────────────────────────

describe('hooksInject', () => {
    it('should inject hooks into all tools when config exists', async () => {
        await hooksInject({});

        expect(mockedAutoDetectInit).toHaveBeenCalled();
        expect(mockedInjectHooksToAllTools).toHaveBeenCalledWith(
            mockTeamConfig.toolPaths,
            expect.any(String),
        );
        expect(mockedLog.success).toHaveBeenCalledWith(
            expect.stringContaining('Hooks injected'),
        );
    });

    it('should suppress success message with --silent option', async () => {
        await hooksInject({ silent: true });

        expect(mockedInjectHooksToAllTools).toHaveBeenCalled();
        expect(mockedLog.success).not.toHaveBeenCalled();
    });

    it('should propagate error when not initialized', async () => {
        mockedAutoDetectInit.mockRejectedValue(new Error('teamai is not initialized'));

        await expect(hooksInject({})).rejects.toThrow('not initialized');
    });

    it('should use project scope baseDir when project config detected', async () => {
        const projectConfig = {
            ...mockLocalConfig,
            scope: 'project',
            projectRoot: '/path/to/project',
        };
        mockedAutoDetectInit.mockResolvedValue({ localConfig: projectConfig, teamConfig: mockTeamConfig });

        await hooksInject({});

        expect(mockedInjectHooksToAllTools).toHaveBeenCalledWith(
            mockTeamConfig.toolPaths,
            '/path/to/project',
        );
    });
});

describe('hooksRemove', () => {
    it('should remove hooks from all tools with settings', async () => {
        await hooksRemove({});

        expect(mockedRemoveHooks).toHaveBeenCalledTimes(3); // claude, claude-internal, cursor
        expect(mockedLog.success).toHaveBeenCalledWith(
            expect.stringContaining('Hooks removed'),
        );
    });

    it('should warn on removal failure for individual tools', async () => {
        mockedRemoveHooks
            .mockResolvedValueOnce(undefined) // claude OK
            .mockRejectedValueOnce(new Error('ENOENT')) // claude-internal fails
            .mockResolvedValueOnce(undefined); // cursor OK

        await hooksRemove({});

        expect(mockedLog.warn).toHaveBeenCalledWith(
            expect.stringContaining('Failed to remove hooks from claude-internal'),
        );
        expect(mockedLog.success).toHaveBeenCalled();
    });

    it('should propagate error when not initialized', async () => {
        mockedAutoDetectInit.mockRejectedValue(new Error('teamai is not initialized'));

        await expect(hooksRemove({})).rejects.toThrow('not initialized');
    });
});
