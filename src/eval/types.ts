import { z } from 'zod';

// ─── Test case (input) ──────────────────────────────────

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  prompt: z.string().min(1),
  expectedTrigger: z.boolean(),
  expectedTopics: z.array(z.string()).default([]),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalCasesFileSchema = z.object({
  version: z.number().default(1),
  cases: z.array(EvalCaseSchema).min(1),
});

export type EvalCasesFile = z.infer<typeof EvalCasesFileSchema>;

// ─── Recall doc (parsed from eval log) ──────────────────

export interface RecallDoc {
  rank: number;
  title: string;
  filename: string;
  score: number;
  tags: string[];
  scope: 'user' | 'project' | '';
}

// ─── Eval log entry (written by auto-recall) ────────────

export interface EvalLogEntry {
  query: string;
  results: Array<{
    filename: string;
    title: string;
    score: number;
    tags: string[];
  }>;
  searchMs: number;
  strategy: string;
}

// ─── LLM score result ───────────────────────────────────

export const ScoreResultSchema = z.object({
  relevance: z.number().int().min(0).max(3),
  adoption: z.number().int().min(0).max(3),
  usefulness: z.number().int().min(0).max(3),
  notes: z.string(),
});

export type ScoreResult = z.infer<typeof ScoreResultSchema>;

// ─── Run result (per case) ──────────────────────────────

export const RunResultSchema = z.object({
  caseId: z.string(),
  prompt: z.string(),
  triggered: z.boolean(),
  expectedTrigger: z.boolean(),
  triggerMatch: z.boolean(),
  falsePositive: z.boolean().default(false),
  recallDocs: z.array(z.object({
    rank: z.number(),
    title: z.string(),
    filename: z.string(),
    score: z.number(),
  })),
  claudeResponse: z.string(),
  scores: ScoreResultSchema.nullable(),
  scoreError: z.string().nullable().default(null),
  elapsedMs: z.number(),
  recallMs: z.number().nullable(),
  error: z.string().nullable().default(null),
});

export type RunResult = z.infer<typeof RunResultSchema>;

// ─── Full eval report ───────────────────────────────────

export const EvalReportSchema = z.object({
  version: z.literal(1),
  runAt: z.string(),
  strategy: z.string(),
  scorerVersion: z.string(),
  recallEnabled: z.boolean(),
  cases: z.array(RunResultSchema),
  summary: z.object({
    totalCases: z.number(),
    triggerAccuracy: z.number(),
    hitRate: z.number(),
    avgRelevance: z.number(),
    avgAdoption: z.number(),
    avgUsefulness: z.number(),
    avgElapsedMs: z.number(),
    avgRecallMs: z.number().nullable(),
    knowledgeGaps: z.array(z.string()),
  }),
});

export type EvalReport = z.infer<typeof EvalReportSchema>;
