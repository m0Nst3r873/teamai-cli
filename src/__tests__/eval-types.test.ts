import { describe, it, expect } from 'vitest';
import { EvalCaseSchema, RunResultSchema, ScoreResultSchema, EvalReportSchema } from '../eval/types.js';

describe('eval types', () => {
  it('validates a valid EvalCase', () => {
    const result = EvalCaseSchema.safeParse({
      id: 'bash-error-oom',
      description: 'GPU OOM',
      prompt: 'K8s pod OOMKilled',
      expectedTrigger: true,
      expectedTopics: ['OOM', 'GPU'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects EvalCase missing required fields', () => {
    const result = EvalCaseSchema.safeParse({ id: 'x' });
    expect(result.success).toBe(false);
  });

  it('validates a valid ScoreResult', () => {
    const result = ScoreResultSchema.safeParse({
      relevance: 2,
      adoption: 3,
      usefulness: 1,
      notes: 'good match',
    });
    expect(result.success).toBe(true);
  });

  it('rejects scores outside 0-3 range', () => {
    const result = ScoreResultSchema.safeParse({
      relevance: 5,
      adoption: 0,
      usefulness: 0,
      notes: '',
    });
    expect(result.success).toBe(false);
  });
});
