import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';

vi.mock('../utils/logger.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    dim: vi.fn(),
  },
  spinner: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../types.js', () => ({
  TEAMAI_HOME: '/tmp/test-teamai-home',
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn().mockResolvedValue(false),
  ensureDir: vi.fn(),
}));

import { gfGetOAuthToken } from '../utils/gf-cli.js';

const mockExecSync = vi.mocked(execSync);

describe('gfGetOAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should query git credential with username=oauth2', () => {
    mockExecSync.mockReturnValue(
      'protocol=https\nhost=git.woa.com\nusername=oauth2\npassword=my-oauth-token\n',
    );

    const token = gfGetOAuthToken();

    expect(token).toBe('my-oauth-token');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('username=oauth2'),
      expect.any(Object),
    );
  });

  it('should NOT query credential without username (would return plain password)', () => {
    mockExecSync.mockReturnValue(
      'protocol=https\nhost=git.woa.com\nusername=oauth2\npassword=my-oauth-token\n',
    );

    gfGetOAuthToken();

    const cmd = mockExecSync.mock.calls[0][0] as string;
    // The credential query must include username=oauth2 to avoid getting
    // the user's plain password from keychain
    expect(cmd).toMatch(/username=oauth2/);
    // Should not have a bare query without username
    expect(cmd).not.toMatch(/host=git\.woa\.com\\n"\s*\|/);
  });

  it('should return null when credential fill fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('credential fill failed');
    });

    const token = gfGetOAuthToken();
    expect(token).toBeNull();
  });

  it('should return null when no password in output', () => {
    mockExecSync.mockReturnValue(
      'protocol=https\nhost=git.woa.com\nusername=oauth2\n',
    );

    const token = gfGetOAuthToken();
    expect(token).toBeNull();
  });

  it('should trim whitespace from token', () => {
    mockExecSync.mockReturnValue(
      'protocol=https\nhost=git.woa.com\nusername=oauth2\npassword=  token-with-spaces  \n',
    );

    const token = gfGetOAuthToken();
    expect(token).toBe('token-with-spaces');
  });
});
