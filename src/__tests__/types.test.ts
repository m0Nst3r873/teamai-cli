import { describe, it, expect } from 'vitest';
import {
  MemberRole,
  ROLE_TO_ACCESS_LEVEL,
  MemberConfigSchema,
} from '../types.js';

describe('MemberRole', () => {
  it('should accept "readonly"', () => {
    expect(MemberRole.parse('readonly')).toBe('readonly');
  });

  it('should accept "write"', () => {
    expect(MemberRole.parse('write')).toBe('write');
  });

  it('should reject invalid roles', () => {
    expect(() => MemberRole.parse('admin')).toThrow();
    expect(() => MemberRole.parse('')).toThrow();
  });
});

describe('ROLE_TO_ACCESS_LEVEL', () => {
  it('should map readonly to 30 (Developer)', () => {
    expect(ROLE_TO_ACCESS_LEVEL.readonly).toBe(30);
  });

  it('should map write to 40 (Master)', () => {
    expect(ROLE_TO_ACCESS_LEVEL.write).toBe(40);
  });
});

describe('MemberConfigSchema', () => {
  it('should parse a complete member config', () => {
    const result = MemberConfigSchema.parse({
      username: 'alice',
      displayName: 'Alice Chen',
      registeredAt: '2025-01-01T00:00:00.000Z',
      role: 'write',
    });
    expect(result).toEqual({
      username: 'alice',
      displayName: 'Alice Chen',
      registeredAt: '2025-01-01T00:00:00.000Z',
      role: 'write',
    });
  });

  it('should default role to "readonly" when not provided (backward compat)', () => {
    const result = MemberConfigSchema.parse({
      username: 'bob',
      registeredAt: '2025-01-01T00:00:00.000Z',
    });
    expect(result.role).toBe('readonly');
  });

  it('should default displayName to empty string', () => {
    const result = MemberConfigSchema.parse({
      username: 'bob',
      registeredAt: '2025-01-01T00:00:00.000Z',
    });
    expect(result.displayName).toBe('');
  });

  it('should reject missing required fields', () => {
    expect(() => MemberConfigSchema.parse({ username: 'x' })).toThrow();
    expect(() => MemberConfigSchema.parse({ registeredAt: 'x' })).toThrow();
  });

  it('should reject invalid role values', () => {
    expect(() =>
      MemberConfigSchema.parse({
        username: 'x',
        registeredAt: '2025-01-01T00:00:00.000Z',
        role: 'admin',
      }),
    ).toThrow();
  });
});
