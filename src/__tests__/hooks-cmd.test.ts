import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ── Mocks ────────────────────────────────────────────────

vi.mock('../config.js', () => ({
    loadLocalConfig: vi.fn(),
    loadTeamConfig: vi.fn(),
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

import { loadLocalConfig, loadTeamConfig } from '../config.js';
import { injectHooksToAllTools, removeHooks } from '../hooks.js';
import { log } from '../utils/logger.js';
import { hooksInject, hooksRemove } from '../hooks-cmd.js';

const mockedLoadLocalConfig = loadLocalConfig as Mock;
const mockedLoadTeamConfig = loadTeamConfig as Mock;
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
    mockedLoadLocalConfig.mockResolvedValue(mockLocalConfig);
    mockedLoadTeamConfig.mockResolvedValue(mockTeamConfig);
    mockedInjectHooksToAllTools.mockResolvedValue(undefined);
    mockedRemoveHooks.mockResolvedValue(undefined);
});

// ── Tests ────────────────────────────────────────────────

describe('hooksInject', () => {
    it('should inject hooks into all tools when config exists', async () => {
        await hooksInject({});

        expect(mockedLoadLocalConfig).toHaveBeenCalled();
        expect(mockedLoadTeamConfig).toHaveBeenCalledWith('/tmp/repo');
        expect(mockedInjectHooksToAllTools).toHaveBeenCalledWith(mockTeamConfig.toolPaths);
        expect(mockedLog.success).toHaveBeenCalledWith(
            expect.stringContaining('Hooks injected'),
        );
    });

    it('should suppress success message with --silent option', async () => {
        await hooksInject({ silent: true });

        expect(mockedInjectHooksToAllTools).toHaveBeenCalled();
        expect(mockedLog.success).not.toHaveBeenCalled();
    });

    it('should exit with error when not initialized (no local config)', async () => {
        mockedLoadLocalConfig.mockResolvedValue(null);
        const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('process.exit');
        });

        await expect(hooksInject({})).rejects.toThrow('process.exit');

        expect(mockedLog.error).toHaveBeenCalledWith(
            expect.stringContaining('not initialized'),
        );
        expect(mockExit).toHaveBeenCalledWith(1);
        mockExit.mockRestore();
    });

    it('should exit with error when team config is missing', async () => {
        mockedLoadTeamConfig.mockResolvedValue(null);
        const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('process.exit');
        });

        await expect(hooksInject({})).rejects.toThrow('process.exit');

        expect(mockedLog.error).toHaveBeenCalledWith(
            expect.stringContaining('teamai.yaml'),
        );
        expect(mockExit).toHaveBeenCalledWith(1);
        mockExit.mockRestore();
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

    it('should exit with error when not initialized', async () => {
        mockedLoadLocalConfig.mockResolvedValue(null);
        const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('process.exit');
        });

        await expect(hooksRemove({})).rejects.toThrow('process.exit');

        expect(mockedLog.error).toHaveBeenCalledWith(
            expect.stringContaining('not initialized'),
        );
        mockExit.mockRestore();
    });
});
