import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger to avoid side effects
vi.mock('../utils/logger.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    dim: vi.fn(),
  },
}));

// We need to mock `fetch` at the global level and set TGIT_TOKEN
const mockFetch = vi.fn();

describe('TGit member management APIs', () => {
  const originalEnv = process.env.TGIT_TOKEN;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.TGIT_TOKEN = 'test-token-123';
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TGIT_TOKEN = originalEnv;
    } else {
      delete process.env.TGIT_TOKEN;
    }
    globalThis.fetch = originalFetch;
  });

  describe('searchUsers', () => {
    it('should call GET /users?search= with encoded query', async () => {
      const mockUsers = [
        { id: 1, username: 'alice', name: 'Alice Chen' },
        { id: 2, username: 'alice2', name: 'Alice Wang' },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockUsers),
      });

      // Dynamic import to pick up mocked fetch
      const { searchUsers } = await import('../utils/tgit-api.js');
      const result = await searchUsers('alice');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/users?search=alice');
      expect(calledUrl).toContain('private_token=test-token-123');
      expect(result).toEqual(mockUsers);
    });

    it('should throw on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const { searchUsers } = await import('../utils/tgit-api.js');
      await expect(searchUsers('fail')).rejects.toThrow('TGit API error 500');
    });
  });

  describe('addProjectMember', () => {
    it('should POST to /projects/:id/members with user_id and access_level', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { addProjectMember } = await import('../utils/tgit-api.js');
      await addProjectMember('team%2Frepo', 42, 30);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/projects/team%2Frepo/members');
      const calledOpts = mockFetch.mock.calls[0][1] as RequestInit;
      expect(calledOpts.method).toBe('POST');
      const body = JSON.parse(calledOpts.body as string);
      expect(body).toEqual({ user_id: 42, access_level: 30 });
    });
  });

  describe('updateProjectMember', () => {
    it('should PUT to /projects/:id/members/:user_id with access_level', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { updateProjectMember } = await import('../utils/tgit-api.js');
      await updateProjectMember('team%2Frepo', 42, 40);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/projects/team%2Frepo/members/42');
      const calledOpts = mockFetch.mock.calls[0][1] as RequestInit;
      expect(calledOpts.method).toBe('PUT');
      const body = JSON.parse(calledOpts.body as string);
      expect(body).toEqual({ access_level: 40 });
    });
  });
});
