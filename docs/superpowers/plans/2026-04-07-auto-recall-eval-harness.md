# Auto-Recall Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `teamai eval-recall` — a CLI command that runs test cases via `claude -p`, captures auto-recall output, scores results with LLM, and generates comparison reports.

**Architecture:** Event-driven eval pipeline: YAML test cases → serial `claude -p` execution → dual-channel recall capture (env var log file + stdout parsing) → LLM scoring via Anthropic API (haiku) → CLI report with A/B comparison support.

**Tech Stack:** TypeScript, Commander.js (CLI), Anthropic SDK (haiku scorer), vitest (tests), YAML (test cases), JSONL (eval log)

**Spec:** `docs/superpowers/specs/2026-04-07-auto-recall-eval-harness-design.md` (on branch `fix/init-skip-missing-roles-manifest`)

**Prerequisites:**
- Install `@anthropic-ai/sdk` as a dependency: `npm install @anthropic-ai/sdk`

---

## File Structure

```
src/
├── eval/
│   ├── types.ts           # EvalCase, RunResult, ScoreResult, EvalReport types
│   ├── runner.ts           # Execute cases via claude -p, capture output
│   ├── parser.ts           # Parse recall output from eval log + stdout
│   ├── scorer.ts           # LLM scoring via Anthropic API (haiku)
│   ├── report.ts           # CLI report formatting (single run + A/B compare)
│   └── compare.ts          # A/B comparison logic between two result sets
├── auto-recall.ts          # MODIFY: add TEAMAI_EVAL_LOG_PATH + TEAMAI_RECALL_DISABLED
├── index.ts                # MODIFY: register eval-recall command
src/__tests__/
├── eval-types.test.ts      # Type validation tests
├── eval-parser.test.ts     # Parser unit tests
├── eval-scorer.test.ts     # Scorer unit tests (mocked API)
├── eval-report.test.ts     # Report formatting tests
├── eval-compare.test.ts    # A/B compare logic tests
├── eval-runner.test.ts     # Runner tests (mocked claude -p)
eval/
├── recall-cases.yaml       # Test case definitions
└── results/
    └── .gitignore           # Ignore result JSON files
```

---

### Task 1: Define eval types

**Files:**
- Create: `src/eval/types.ts`
- Test: `src/__tests__/eval-types.test.ts`

- [ ] **Step 1: Write the failing test for type schemas**

Create `src/__tests__/eval-types.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-types.test.ts`
Expected: FAIL — module `../eval/types.js` not found

- [ ] **Step 3: Implement eval types**

Create `src/eval/types.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-types.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/eval/types.ts src/__tests__/eval-types.test.ts
git commit -m "feat(eval): add type definitions for eval harness"
```

---

### Task 2: Modify auto-recall to support eval log + disable flag

**Files:**
- Modify: `src/auto-recall.ts` (lines 458-555, the `autoRecall()` function)
- Test: `src/__tests__/auto-recall.test.ts` (add new tests)

- [ ] **Step 1: Write failing tests for eval log and disable flag**

Append to `src/__tests__/auto-recall.test.ts` (at the end, inside or after existing describe blocks):

```typescript
describe('eval integration', () => {
  it('skips all recall when TEAMAI_RECALL_DISABLED=1', async () => {
    process.env.TEAMAI_RECALL_DISABLED = '1';
    // Mock STDIN with a Bash error that would normally trigger recall
    const stdinData = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'python run.py' },
      tool_response: { stdout: '', stderr: 'ModuleNotFoundError: No module named sglang' },
      session_id: 'test-disabled',
    });
    vi.spyOn(process.stdin, 'read').mockReturnValue(Buffer.from(stdinData));
    // autoRecall should exit without searching
    // We verify by checking no stdout was written
    const writeSpy = vi.spyOn(process.stdout, 'write');
    const { autoRecall } = await import('../auto-recall.js');
    await autoRecall();
    expect(writeSpy).not.toHaveBeenCalled();
    delete process.env.TEAMAI_RECALL_DISABLED;
  });

  it('writes eval log when TEAMAI_EVAL_LOG_PATH is set and search returns results', async () => {
    const logPath = path.join(tmpDir, 'eval-log.jsonl');
    process.env.TEAMAI_EVAL_LOG_PATH = logPath;
    // Build a minimal search index in tmpDir
    const indexPath = path.join(tmpDir, 'search-index.json');
    const testIndex = {
      builtAt: new Date().toISOString(),
      elapsedMs: 10,
      entries: [{
        filename: 'test-doc.md', title: 'ModuleNotFoundError fix',
        author: 'test', date: '2026-04-01',
        tags: ['python', 'sglang'],
        tokens: ['title:modulenotfounderror', 'title:fix', 'tag:python', 'tag:sglang', 'modulenotfounderror', 'fix', 'python', 'sglang'],
        votes: 1,
      }],
    };
    fs.writeFileSync(indexPath, JSON.stringify(testIndex));
    // Mock loadIndex to use our test index
    // ... (mock setup depends on existing test patterns in auto-recall.test.ts)
    // After running autoRecall with an error input, verify the log file was created
    expect(fs.existsSync(logPath)).toBe(true);
    const logContent = fs.readFileSync(logPath, 'utf-8');
    const entry = JSON.parse(logContent.trim());
    expect(entry.query).toBeTruthy();
    expect(entry.searchMs).toBeGreaterThanOrEqual(0);
    delete process.env.TEAMAI_EVAL_LOG_PATH;
  });
});
```

> **Note:** The full integration test is in Task 6 (runner tests). Here we only add the unit-level checks for the env var behavior.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/auto-recall.test.ts -t "eval integration"`
Expected: FAIL (import or behavior mismatch)

- [ ] **Step 3: Modify auto-recall.ts**

In `src/auto-recall.ts`, add the following changes:

**At the top of `autoRecall()` function (line ~458), add disable check:**

```typescript
export async function autoRecall(): Promise<void> {
    // ─── Eval harness: disable flag ────────────────────
    if (process.env.TEAMAI_RECALL_DISABLED === '1') {
        return;
    }

    const input = await readStdin();
    // ... rest unchanged until after search results ...
```

**After the search results are obtained (after line ~526), before formatting, add eval log writing:**

```typescript
    // Search
    const results = search(query, index, 3);

    // ─── Eval harness: write structured log ────────────
    // Intentionally placed BEFORE the "no results" early return so that
    // zero-result searches are also logged — useful for eval gap analysis.
    const evalLogPath = process.env.TEAMAI_EVAL_LOG_PATH;
    if (evalLogPath) {
        const searchMs = Date.now() - searchStart; // need to add searchStart before search()
        const evalEntry = JSON.stringify({
            query,
            results: results.map((r) => ({
                filename: r.entry.filename,
                title: r.entry.title,
                score: r.score,
                tags: r.entry.tags,
            })),
            searchMs,
            strategy: process.env.TEAMAI_SEARCH_STRATEGY ?? 'keyword-v1',
        });
        try {
            fs.appendFileSync(evalLogPath, evalEntry + '\n');
        } catch {
            // Silent: eval log failure should never affect hook output
        }
    }

    if (results.length === 0) {
```

**Also add `searchStart` timing before the search call:**

```typescript
    // Search
    const searchStart = Date.now();
    const results = search(query, index, 3);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/auto-recall.test.ts`
Expected: ALL PASS (existing + new tests)

- [ ] **Step 5: Commit**

```bash
git add src/auto-recall.ts src/__tests__/auto-recall.test.ts
git commit -m "feat(eval): add TEAMAI_EVAL_LOG_PATH and TEAMAI_RECALL_DISABLED to auto-recall"
```

---

### Task 3: Build the eval log parser

**Files:**
- Create: `src/eval/parser.ts`
- Test: `src/__tests__/eval-parser.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/eval-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseEvalLog, parseStdoutRecall } from '../eval/parser.js';

describe('parseEvalLog', () => {
  it('parses a single JSONL line', () => {
    const line = JSON.stringify({
      query: 'ModuleNotFoundError',
      results: [{ filename: 'doc.md', title: 'Fix import', score: 12.5, tags: ['python'] }],
      searchMs: 23,
      strategy: 'keyword-v1',
    });
    const entries = parseEvalLog(line);
    expect(entries).toHaveLength(1);
    expect(entries[0].query).toBe('ModuleNotFoundError');
    expect(entries[0].results[0].score).toBe(12.5);
    expect(entries[0].searchMs).toBe(23);
  });

  it('parses multiple JSONL lines', () => {
    const lines = [
      JSON.stringify({ query: 'q1', results: [], searchMs: 1, strategy: 'v1' }),
      JSON.stringify({ query: 'q2', results: [], searchMs: 2, strategy: 'v1' }),
    ].join('\n');
    const entries = parseEvalLog(lines);
    expect(entries).toHaveLength(2);
  });

  it('skips invalid lines gracefully', () => {
    const lines = 'not json\n' + JSON.stringify({ query: 'ok', results: [], searchMs: 1, strategy: 'v1' });
    const entries = parseEvalLog(lines);
    expect(entries).toHaveLength(1);
    expect(entries[0].query).toBe('ok');
  });

  it('returns empty for empty input', () => {
    expect(parseEvalLog('')).toEqual([]);
  });
});

describe('parseStdoutRecall', () => {
  it('detects recall start/end markers', () => {
    const output = `Some text
--- [teamai:recall:start] --- (2 results)

[1/2] Fix import ★2
Author: jeff | Date: 2026-03-20 | Score: 12.5
Tags: python, import
File: ~/.teamai/learnings/fix-import-2026-03-20-abc.md

[2/2] API timeout ★1
Author: jeff | Date: 2026-03-21 | Score: 8.0
Tags: api, timeout
File: ~/.teamai/learnings/api-timeout-2026-03-21-def.md

--- [teamai:recall:end] ---
More text`;
    const result = parseStdoutRecall(output);
    expect(result.triggered).toBe(true);
    expect(result.docs).toHaveLength(2);
    expect(result.docs[0].title).toBe('Fix import');
    expect(result.docs[0].score).toBe(12.5);
    expect(result.docs[1].title).toBe('API timeout');
  });

  it('returns triggered=false when no markers', () => {
    const result = parseStdoutRecall('just normal output');
    expect(result.triggered).toBe(false);
    expect(result.docs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement parser**

Create `src/eval/parser.ts`:

```typescript
import type { EvalLogEntry, RecallDoc } from './types.js';

/**
 * Parse JSONL eval log content into structured entries.
 * Skips malformed lines gracefully.
 */
export function parseEvalLog(content: string): EvalLogEntry[] {
  if (!content.trim()) return [];

  const entries: EvalLogEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as EvalLogEntry;
      if (parsed.query !== undefined && Array.isArray(parsed.results)) {
        entries.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

/** Result of parsing stdout for recall markers. */
export interface StdoutRecallResult {
  triggered: boolean;
  docs: RecallDoc[];
  rawRecallBlock: string;
}

/**
 * Parse claude -p stdout for [teamai:recall:start/end] markers.
 * Fallback parser when eval log file is unavailable.
 *
 * NOTE: These markers come from `formatResults()` in recall.ts, which is called
 * by auto-recall.ts. The markers appear inside the `additionalContext` field
 * of the hook output JSON. In `claude -p --verbose` mode, they may appear in
 * the verbose output. If the primary TEAMAI_EVAL_LOG_PATH channel works,
 * this fallback is not needed.
 */
export function parseStdoutRecall(output: string): StdoutRecallResult {
  const startMarker = '--- [teamai:recall:start] ---';
  const endMarker = '--- [teamai:recall:end] ---';

  const startIdx = output.indexOf(startMarker);
  const endIdx = output.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { triggered: false, docs: [], rawRecallBlock: '' };
  }

  const block = output.slice(startIdx, endIdx + endMarker.length);
  const docs: RecallDoc[] = [];

  // Parse each [N/M] Title ★votes line
  const docPattern = /\[(\d+)\/\d+\]\s+(.+?)(?:\s+★(\d+))?\s*\n\s*Author:.*?\|\s*Score:\s*([\d.]+)\s*\n\s*Tags:\s*(.*?)\s*\n\s*File:\s*(.*?\.md)/g;

  let match: RegExpExecArray | null;
  while ((match = docPattern.exec(block)) !== null) {
    docs.push({
      rank: parseInt(match[1], 10),
      title: match[2].trim(),
      filename: match[6].trim().replace(/^.*\/learnings\//, ''),
      score: parseFloat(match[4]),
      tags: match[5].split(',').map((t) => t.trim()).filter(Boolean),
      scope: '',
    });
  }

  return { triggered: true, docs, rawRecallBlock: block };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/eval/parser.ts src/__tests__/eval-parser.test.ts
git commit -m "feat(eval): add eval log and stdout recall parser"
```

---

### Task 4: Build the LLM scorer

**Files:**
- Create: `src/eval/scorer.ts`
- Test: `src/__tests__/eval-scorer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/eval-scorer.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildScoringPrompt, parseScoreResponse, SCORER_VERSION } from '../eval/scorer.js';

describe('buildScoringPrompt', () => {
  it('includes prompt, docs, and response in output', () => {
    const result = buildScoringPrompt(
      'ModuleNotFoundError sglang',
      [{ title: 'Fix import', tags: ['python'], filename: 'doc.md', score: 12 }],
      'Try pip install sglang',
    );
    expect(result).toContain('ModuleNotFoundError sglang');
    expect(result).toContain('Fix import');
    expect(result).toContain('Try pip install sglang');
    expect(result).toContain('relevance');
    expect(result).toContain('adoption');
    expect(result).toContain('usefulness');
  });
});

describe('parseScoreResponse', () => {
  it('parses valid JSON directly', () => {
    const raw = '{"relevance": 2, "adoption": 3, "usefulness": 1, "notes": "good"}';
    const result = parseScoreResponse(raw);
    expect(result).toEqual({ relevance: 2, adoption: 3, usefulness: 1, notes: 'good' });
  });

  it('extracts JSON from markdown code fence', () => {
    const raw = 'Here is my analysis:\n```json\n{"relevance": 1, "adoption": 0, "usefulness": 0, "notes": "irrelevant"}\n```';
    const result = parseScoreResponse(raw);
    expect(result).toEqual({ relevance: 1, adoption: 0, usefulness: 0, notes: 'irrelevant' });
  });

  it('returns null for completely unparseable output', () => {
    const result = parseScoreResponse('I cannot score this because...');
    expect(result).toBeNull();
  });

  it('rejects scores outside 0-3 range', () => {
    const raw = '{"relevance": 5, "adoption": 0, "usefulness": 0, "notes": ""}';
    const result = parseScoreResponse(raw);
    expect(result).toBeNull();
  });
});

describe('SCORER_VERSION', () => {
  it('is a non-empty string', () => {
    expect(SCORER_VERSION).toBeTruthy();
    expect(typeof SCORER_VERSION).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-scorer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement scorer**

Create `src/eval/scorer.ts`:

```typescript
import { ScoreResultSchema } from './types.js';
import type { ScoreResult } from './types.js';

/** Model used for scoring. Update when newer snapshot available. */
const SCORER_MODEL = 'claude-haiku-4-20250414';

export const SCORER_VERSION = 'v1';

interface ScoringDoc {
  title: string;
  tags: string[];
  filename: string;
  score: number;
}

/**
 * Build the scoring prompt for the LLM evaluator.
 */
export function buildScoringPrompt(
  prompt: string,
  docs: ScoringDoc[],
  claudeResponse: string,
): string {
  const docList = docs.map((d, i) =>
    `${i + 1}. **${d.title}** (score: ${d.score})\n   Tags: ${d.tags.join(', ')}\n   File: ${d.filename}`
  ).join('\n');

  return `你是一个搜索质量评估专家。请根据以下信息评分。

## 用户问题
${prompt}

## 团队知识库召回的文档
${docList || '(无召回结果)'}

## Claude 的回答
${claudeResponse.slice(0, 3000)}

请对以下三个维度评分（0-3 分）：

1. **relevance（相关性）**：召回的文档跟用户问题相关吗？
   - 0: 完全无关
   - 1: 略微相关，但不是用户需要的
   - 2: 相关，但不够精准
   - 3: 高度相关，正是用户需要的

2. **adoption（采纳度）**：Claude 的回答中是否引用/使用了召回的内容？
   - 0: 完全没用上
   - 1: 提到了但没实际使用
   - 2: 使用了部分内容
   - 3: 核心回答基于召回内容

3. **usefulness（感知价值）**：仅凭 recall 内容判断，这些文档对解决问题有多大价值？
   - 0: 没有帮助，可能还干扰了
   - 1: 略有帮助，提供了一些背景
   - 2: 明显有用，包含了关键信息
   - 3: 非常关键，直接解决了问题

输出严格 JSON 格式（不要包裹在代码块中）：
{"relevance": N, "adoption": N, "usefulness": N, "notes": "简要说明"}`;
}

/**
 * Parse LLM response into a ScoreResult.
 * Uses 3-level fallback: direct JSON → code fence extraction → regex.
 * Returns null if all parsing attempts fail.
 */
export function parseScoreResponse(raw: string): ScoreResult | null {
  // Level 1: direct JSON parse
  const parsed = tryParseJson(raw.trim());
  if (parsed) return parsed;

  // Level 2: extract from markdown code fence
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const fenceParsed = tryParseJson(fenceMatch[1].trim());
    if (fenceParsed) return fenceParsed;
  }

  // Level 3: regex extraction
  const regexMatch = raw.match(/"relevance"\s*:\s*(\d),?\s*"adoption"\s*:\s*(\d),?\s*"usefulness"\s*:\s*(\d)/);
  if (regexMatch) {
    const notesMatch = raw.match(/"notes"\s*:\s*"([^"]*)"/);
    const candidate = {
      relevance: parseInt(regexMatch[1], 10),
      adoption: parseInt(regexMatch[2], 10),
      usefulness: parseInt(regexMatch[3], 10),
      notes: notesMatch ? notesMatch[1] : '',
    };
    return validateScore(candidate);
  }

  return null;
}

function tryParseJson(text: string): ScoreResult | null {
  try {
    const obj = JSON.parse(text);
    return validateScore(obj);
  } catch {
    return null;
  }
}

function validateScore(obj: unknown): ScoreResult | null {
  const result = ScoreResultSchema.safeParse(obj);
  return result.success ? result.data : null;
}

/**
 * Call Anthropic API to score a recall result.
 * Uses haiku for cost efficiency (~$0.0001/call).
 */
export async function scoreWithLLM(
  prompt: string,
  docs: ScoringDoc[],
  claudeResponse: string,
): Promise<{ score: ScoreResult | null; error: string | null }> {
  const scoringPrompt = buildScoringPrompt(prompt, docs, claudeResponse);

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const response = await client.messages.create({
      model: SCORER_MODEL,
      max_tokens: 200,
      temperature: 0,
      messages: [{ role: 'user', content: scoringPrompt }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const score = parseScoreResponse(text);
    if (score) return { score, error: null };

    // Retry once on parse failure
    const retryResponse = await client.messages.create({
      model: SCORER_MODEL,
      max_tokens: 200,
      temperature: 0,
      messages: [{ role: 'user', content: scoringPrompt + '\n\n重要：只输出 JSON，不要其他文字。' }],
    });

    const retryText = retryResponse.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const retryScore = parseScoreResponse(retryText);
    return { score: retryScore, error: retryScore ? null : `Failed to parse scorer output after retry: ${retryText.slice(0, 100)}` };
  } catch (err) {
    return { score: null, error: `Anthropic API error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-scorer.test.ts`
Expected: PASS (5 tests — the pure function tests; `scoreWithLLM` is not unit tested here)

- [ ] **Step 5: Commit**

```bash
git add src/eval/scorer.ts src/__tests__/eval-scorer.test.ts
git commit -m "feat(eval): add LLM scorer with 3-level JSON parsing fallback"
```

---

### Task 5: Build the CLI report formatter

**Files:**
- Create: `src/eval/report.ts`
- Create: `src/eval/compare.ts`
- Test: `src/__tests__/eval-report.test.ts`
- Test: `src/__tests__/eval-compare.test.ts`

- [ ] **Step 1: Write failing tests for report**

Create `src/__tests__/eval-report.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeSummary, formatSingleReport } from '../eval/report.js';
import type { RunResult } from '../eval/types.js';

const makeResult = (overrides: Partial<RunResult> = {}): RunResult => ({
  caseId: 'test-case',
  prompt: 'test prompt',
  triggered: true,
  expectedTrigger: true,
  triggerMatch: true,
  falsePositive: false,
  recallDocs: [{ rank: 1, title: 'Doc', filename: 'doc.md', score: 10 }],
  claudeResponse: 'response',
  scores: { relevance: 2, adoption: 2, usefulness: 2, notes: '' },
  scoreError: null,
  elapsedMs: 1000,
  recallMs: 20,
  error: null,
  ...overrides,
});

describe('computeSummary', () => {
  it('computes correct averages', () => {
    const results = [
      makeResult({ scores: { relevance: 3, adoption: 2, usefulness: 1, notes: '' } }),
      makeResult({ scores: { relevance: 1, adoption: 0, usefulness: 3, notes: '' } }),
    ];
    const summary = computeSummary(results);
    expect(summary.totalCases).toBe(2);
    expect(summary.avgRelevance).toBe(2);
    expect(summary.avgAdoption).toBe(1);
    expect(summary.avgUsefulness).toBe(2);
  });

  it('identifies knowledge gaps (0 results)', () => {
    const results = [
      makeResult({ caseId: 'oom', recallDocs: [], scores: null }),
    ];
    const summary = computeSummary(results);
    expect(summary.knowledgeGaps).toContain('oom');
  });

  it('computes trigger accuracy', () => {
    const results = [
      makeResult({ triggerMatch: true }),
      makeResult({ triggerMatch: false }),
    ];
    const summary = computeSummary(results);
    expect(summary.triggerAccuracy).toBe(0.5);
  });
});

describe('formatSingleReport', () => {
  it('includes summary section', () => {
    const results = [makeResult()];
    const report = formatSingleReport(results, 'keyword-v1');
    expect(report).toContain('Summary');
    expect(report).toContain('Cases run');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-report.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement report.ts**

Create `src/eval/report.ts`:

```typescript
import type { RunResult } from './types.js';

export interface EvalSummary {
  totalCases: number;
  triggerAccuracy: number;
  hitRate: number;
  avgRelevance: number;
  avgAdoption: number;
  avgUsefulness: number;
  avgElapsedMs: number;
  avgRecallMs: number | null;
  knowledgeGaps: string[];
}

/**
 * Compute summary statistics from eval results.
 */
export function computeSummary(results: RunResult[]): EvalSummary {
  const total = results.length;
  if (total === 0) {
    return {
      totalCases: 0, triggerAccuracy: 0, hitRate: 0,
      avgRelevance: 0, avgAdoption: 0, avgUsefulness: 0,
      avgElapsedMs: 0, avgRecallMs: null, knowledgeGaps: [],
    };
  }

  const triggerMatches = results.filter((r) => r.triggerMatch).length;
  const triggered = results.filter((r) => r.triggered);
  const withResults = triggered.filter((r) => r.recallDocs.length > 0);

  const scored = results.filter((r) => r.scores !== null);
  const avgField = (field: 'relevance' | 'adoption' | 'usefulness'): number => {
    if (scored.length === 0) return 0;
    const sum = scored.reduce((acc, r) => acc + (r.scores?.[field] ?? 0), 0);
    return Math.round((sum / scored.length) * 10) / 10;
  };

  const avgElapsed = Math.round(results.reduce((s, r) => s + r.elapsedMs, 0) / total);
  const recallTimes = results.filter((r) => r.recallMs !== null).map((r) => r.recallMs!);
  const avgRecall = recallTimes.length > 0
    ? Math.round(recallTimes.reduce((s, v) => s + v, 0) / recallTimes.length)
    : null;

  const knowledgeGaps = triggered
    .filter((r) => r.recallDocs.length === 0)
    .map((r) => r.caseId);

  return {
    totalCases: total,
    triggerAccuracy: Math.round((triggerMatches / total) * 1000) / 1000,
    hitRate: triggered.length > 0
      ? Math.round((withResults.length / triggered.length) * 1000) / 1000
      : 0,
    avgRelevance: avgField('relevance'),
    avgAdoption: avgField('adoption'),
    avgUsefulness: avgField('usefulness'),
    avgElapsedMs: avgElapsed,
    avgRecallMs: avgRecall,
    knowledgeGaps,
  };
}

/**
 * Format a human-readable CLI report from eval results.
 */
export function formatSingleReport(results: RunResult[], strategy: string): string {
  const summary = computeSummary(results);
  const lines: string[] = [];

  lines.push('📊 Summary');
  lines.push('━'.repeat(50));
  lines.push(`  Cases run:          ${summary.totalCases}`);
  lines.push(`  Strategy:           ${strategy}`);
  lines.push(`  Trigger accuracy:   ${(summary.triggerAccuracy * 100).toFixed(1)}%`);
  lines.push(`  Hit rate:           ${(summary.hitRate * 100).toFixed(1)}%`);
  lines.push(`  Avg relevance:      ${summary.avgRelevance} / 3.0`);
  lines.push(`  Avg adoption:       ${summary.avgAdoption} / 3.0`);
  lines.push(`  Avg usefulness:     ${summary.avgUsefulness} / 3.0`);
  lines.push(`  Avg total time:     ${summary.avgElapsedMs}ms`);
  if (summary.avgRecallMs !== null) {
    lines.push(`  Avg recall time:    ${summary.avgRecallMs}ms`);
  }

  if (summary.knowledgeGaps.length > 0) {
    lines.push('');
    lines.push('⚠️  Knowledge Gaps');
    for (const gap of summary.knowledgeGaps) {
      lines.push(`  - ${gap}`);
    }
    lines.push('  → Consider contributing docs for these topics');
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run report tests**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-report.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for compare**

Create `src/__tests__/eval-compare.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { compareReports, formatCompareReport } from '../eval/compare.js';
import type { EvalReport } from '../eval/types.js';

const makeReport = (strategy: string, avgRelevance: number): EvalReport => ({
  version: 1,
  runAt: '2026-04-07T10:00:00Z',
  strategy,
  scorerVersion: 'v1',
  recallEnabled: true,
  cases: [],
  summary: {
    totalCases: 5,
    triggerAccuracy: 0.8,
    hitRate: 0.6,
    avgRelevance,
    avgAdoption: 1.5,
    avgUsefulness: 1.5,
    avgElapsedMs: 1000,
    avgRecallMs: 25,
    knowledgeGaps: [],
  },
});

describe('compareReports', () => {
  it('computes deltas between two reports', () => {
    const a = makeReport('v1', 2.0);
    const b = makeReport('v2', 2.5);
    const diff = compareReports(a, b);
    expect(diff.relevanceDelta).toBeCloseTo(0.5);
    expect(diff.strategyA).toBe('v1');
    expect(diff.strategyB).toBe('v2');
  });
});

describe('formatCompareReport', () => {
  it('includes both strategies in output', () => {
    const a = makeReport('v1', 2.0);
    const b = makeReport('v2', 2.5);
    const diff = compareReports(a, b);
    const output = formatCompareReport(diff);
    expect(output).toContain('v1');
    expect(output).toContain('v2');
    expect(output).toContain('+0.5');
  });
});
```

- [ ] **Step 6: Run compare tests to verify they fail**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-compare.test.ts`
Expected: FAIL — module `../eval/compare.js` not found

- [ ] **Step 7: Implement compare.ts**

Create `src/eval/compare.ts`:

```typescript
import type { EvalReport } from './types.js';

export interface CompareResult {
  strategyA: string;
  strategyB: string;
  hitRateA: number;
  hitRateB: number;
  hitRateDelta: number;
  relevanceDelta: number;
  adoptionDelta: number;
  usefulnessDelta: number;
  recallTimeDelta: number | null;
}

/**
 * Compare two eval reports and compute deltas.
 */
export function compareReports(a: EvalReport, b: EvalReport): CompareResult {
  return {
    strategyA: a.strategy,
    strategyB: b.strategy,
    hitRateA: a.summary.hitRate,
    hitRateB: b.summary.hitRate,
    hitRateDelta: round(b.summary.hitRate - a.summary.hitRate),
    relevanceDelta: round(b.summary.avgRelevance - a.summary.avgRelevance),
    adoptionDelta: round(b.summary.avgAdoption - a.summary.avgAdoption),
    usefulnessDelta: round(b.summary.avgUsefulness - a.summary.avgUsefulness),
    recallTimeDelta: (a.summary.avgRecallMs !== null && b.summary.avgRecallMs !== null)
      ? b.summary.avgRecallMs - a.summary.avgRecallMs
      : null,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatDelta(d: number, unit = '', lowerIsBetter = false): string {
  const sign = d > 0 ? '+' : '';
  const arrow = d === 0 ? '' : (d > 0 ? (lowerIsBetter ? ' ↓' : ' ↑') : (lowerIsBetter ? ' ↑' : ' ↓'));
  return `${sign}${d}${unit}${arrow}`;
}

/**
 * Format a human-readable A/B comparison report.
 */
export function formatCompareReport(diff: CompareResult): string {
  const lines: string[] = [];
  lines.push(`🔬 A/B Comparison: ${diff.strategyA} vs ${diff.strategyB}`);
  lines.push('━'.repeat(50));
  lines.push('');
  const pad = (s: string, n: number) => s.padEnd(n);
  lines.push(`  ${pad('', 20)}${pad(diff.strategyA, 12)}${pad(diff.strategyB, 12)}delta`);
  lines.push(`  ${pad('Hit rate:', 20)}${pad((diff.hitRateA * 100).toFixed(1) + '%', 12)}${pad((diff.hitRateB * 100).toFixed(1) + '%', 12)}${formatDelta(Math.round(diff.hitRateDelta * 1000) / 10, '%')}`);
  lines.push(`  ${pad('Avg relevance:', 20)}${pad('', 12)}${pad('', 12)}${formatDelta(diff.relevanceDelta)}`);
  lines.push(`  ${pad('Avg adoption:', 20)}${pad('', 12)}${pad('', 12)}${formatDelta(diff.adoptionDelta)}`);
  lines.push(`  ${pad('Avg usefulness:', 20)}${pad('', 12)}${pad('', 12)}${formatDelta(diff.usefulnessDelta)}`);
  if (diff.recallTimeDelta !== null) {
    lines.push(`  ${pad('Avg recall time:', 20)}${pad('', 12)}${pad('', 12)}${formatDelta(diff.recallTimeDelta, 'ms', true)}`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 8: Run compare tests**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-compare.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/eval/report.ts src/eval/compare.ts src/__tests__/eval-report.test.ts src/__tests__/eval-compare.test.ts
git commit -m "feat(eval): add CLI report formatter and A/B comparison"
```

---

### Task 6: Build the eval runner

**Files:**
- Create: `src/eval/runner.ts`
- Test: `src/__tests__/eval-runner.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/eval-runner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildClaudeCommand, processRunOutput, loadCases } from '../eval/runner.js';

describe('buildClaudeCommand', () => {
  it('builds correct claude -p command', () => {
    const cmd = buildClaudeCommand('test prompt', '/tmp/eval.jsonl', true);
    expect(cmd).toContain('claude');
    expect(cmd).toContain('-p');
    expect(cmd).toContain('test prompt');
    expect(cmd).toContain('TEAMAI_EVAL_LOG_PATH=/tmp/eval.jsonl');
  });

  it('includes TEAMAI_RECALL_DISABLED when recall disabled', () => {
    const cmd = buildClaudeCommand('test', '/tmp/log', false);
    expect(cmd).toContain('TEAMAI_RECALL_DISABLED=1');
  });

  it('includes strategy env var when provided', () => {
    const cmd = buildClaudeCommand('test', '/tmp/log', true, 'keyword-v2');
    expect(cmd).toContain('TEAMAI_SEARCH_STRATEGY=keyword-v2');
  });

  it('escapes single quotes in prompt', () => {
    const cmd = buildClaudeCommand("it's a test", '/tmp/log', true);
    expect(cmd).toContain("'\\''");
    expect(cmd).not.toContain("it's");
  });
});

describe('processRunOutput', () => {
  it('extracts claude response from output', () => {
    const result = processRunOutput('Here is my answer to your question.', '/nonexistent');
    expect(result.claudeResponse).toContain('Here is my answer');
    expect(result.triggered).toBe(false);
  });

  it('reads eval log file when present', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-'));
    const logPath = path.join(tmpDir, 'eval.jsonl');
    fs.writeFileSync(logPath, JSON.stringify({
      query: 'test', results: [{ filename: 'a.md', title: 'A', score: 5, tags: [] }],
      searchMs: 10, strategy: 'v1',
    }) + '\n');
    const result = processRunOutput('response', logPath);
    expect(result.triggered).toBe(true);
    expect(result.recallDocs).toHaveLength(1);
    expect(result.recallDocs[0].title).toBe('A');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('loadCases', () => {
  it('loads and validates YAML cases', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-cases-'));
    const casesPath = path.join(tmpDir, 'cases.yaml');
    fs.writeFileSync(casesPath, `version: 1\ncases:\n  - id: test\n    description: test\n    prompt: test prompt\n    expectedTrigger: true\n`);
    const cases = loadCases(casesPath);
    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe('test');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('throws on invalid YAML', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-cases-'));
    const casesPath = path.join(tmpDir, 'cases.yaml');
    fs.writeFileSync(casesPath, 'version: 1\ncases: []');
    expect(() => loadCases(casesPath)).toThrow();
    fs.rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-runner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement runner**

Create `src/eval/runner.ts`:

```typescript
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { log } from '../utils/logger.js';
import { parseEvalLog, parseStdoutRecall } from './parser.js';
import { scoreWithLLM, SCORER_VERSION } from './scorer.js';
import { computeSummary, formatSingleReport } from './report.js';
import { EvalCasesFileSchema } from './types.js';
import type { EvalCase, RunResult, EvalReport, EvalLogEntry } from './types.js';

/**
 * Build the shell command to run claude -p with eval environment variables.
 */
export function buildClaudeCommand(
  prompt: string,
  evalLogPath: string,
  recallEnabled: boolean,
  strategy?: string,
): string {
  const envVars: string[] = [`TEAMAI_EVAL_LOG_PATH=${evalLogPath}`];
  if (!recallEnabled) {
    envVars.push('TEAMAI_RECALL_DISABLED=1');
  }
  if (strategy) {
    envVars.push(`TEAMAI_SEARCH_STRATEGY=${strategy}`);
  }

  // Escape single quotes in prompt for shell safety
  const escaped = prompt.replace(/'/g, "'\\''");
  // Note: Using shell execution for env var injection.
  // Prompt comes from controlled YAML test cases, not user input.
  return `${envVars.join(' ')} claude -p '${escaped}' --verbose 2>&1`;
}

/**
 * Process raw claude output + eval log into structured data.
 */
export function processRunOutput(
  stdout: string,
  evalLogPath: string,
): { claudeResponse: string; evalEntries: EvalLogEntry[]; triggered: boolean; recallDocs: Array<{ rank: number; title: string; filename: string; score: number }> } {
  // Primary: read eval log file
  let evalEntries: EvalLogEntry[] = [];
  try {
    const logContent = fs.readFileSync(evalLogPath, 'utf-8');
    evalEntries = parseEvalLog(logContent);
  } catch {
    // Log file may not exist if recall didn't trigger
  }

  // If eval log has entries, use those
  if (evalEntries.length > 0) {
    const latest = evalEntries[evalEntries.length - 1];
    return {
      claudeResponse: stdout,
      evalEntries,
      triggered: true,
      recallDocs: latest.results.map((r, i) => ({
        rank: i + 1,
        title: r.title,
        filename: r.filename,
        score: r.score,
      })),
    };
  }

  // Fallback: parse stdout for recall markers
  const stdoutResult = parseStdoutRecall(stdout);
  return {
    claudeResponse: stdout,
    evalEntries: [],
    triggered: stdoutResult.triggered,
    recallDocs: stdoutResult.docs.map((d) => ({
      rank: d.rank,
      title: d.title,
      filename: d.filename,
      score: d.score,
    })),
  };
}

/**
 * Load test cases from YAML file.
 */
export function loadCases(casesPath: string): EvalCase[] {
  const raw = fs.readFileSync(casesPath, 'utf-8');
  const parsed = YAML.parse(raw);
  const validated = EvalCasesFileSchema.parse(parsed);
  return validated.cases;
}

/**
 * Clean up recall session cache between test cases.
 */
function cleanupSessionCache(): void {
  const sessionsDir = path.join(os.homedir(), '.teamai', 'sessions');
  try {
    const files = fs.readdirSync(sessionsDir);
    for (const f of files) {
      if (f.endsWith('-recall-cache.json')) {
        fs.unlinkSync(path.join(sessionsDir, f));
      }
    }
  } catch {
    // Sessions dir may not exist
  }
}

/**
 * Run a single eval case: execute claude -p, parse output, score with LLM.
 */
export async function runCase(
  evalCase: EvalCase,
  options: { recallEnabled: boolean; strategy?: string; timeout: number; skipScoring?: boolean },
): Promise<RunResult> {
  const evalLogPath = path.join(os.tmpdir(), `teamai-eval-${evalCase.id}-${Date.now()}.jsonl`);
  const cmd = buildClaudeCommand(evalCase.prompt, evalLogPath, options.recallEnabled, options.strategy);

  const start = Date.now();
  let stdout = '';
  let error: string | null = null;

  try {
    stdout = execSync(cmd, {
      timeout: options.timeout,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024, // 1MB
    });
  } catch (err) {
    if (err instanceof Error) {
      error = err.message.slice(0, 200);
      // execSync may have partial output on timeout
      stdout = (err as { stdout?: string }).stdout ?? '';
    }
  }

  const elapsed = Date.now() - start;
  const { claudeResponse, evalEntries, triggered, recallDocs } = processRunOutput(stdout, evalLogPath);

  // Compute trigger match
  const triggerMatch = triggered === evalCase.expectedTrigger;
  const falsePositive = !evalCase.expectedTrigger && triggered;

  // Get recall timing from eval log
  const recallMs = evalEntries.length > 0 ? evalEntries[evalEntries.length - 1].searchMs : null;

  // Score with LLM (only if triggered and has results)
  let scores = null;
  let scoreError: string | null = null;

  if (!options.skipScoring && triggered && recallDocs.length > 0) {
    const scoringDocs = recallDocs.map((d) => ({
      title: d.title,
      tags: [] as string[],
      filename: d.filename,
      score: d.score,
    }));
    // Enrich tags from eval log if available
    if (evalEntries.length > 0) {
      const latest = evalEntries[evalEntries.length - 1];
      for (let i = 0; i < scoringDocs.length && i < latest.results.length; i++) {
        scoringDocs[i].tags = latest.results[i].tags;
      }
    }

    const result = await scoreWithLLM(evalCase.prompt, scoringDocs, claudeResponse);
    scores = result.score;
    scoreError = result.error;
  }

  // Clean up eval log file
  try { fs.unlinkSync(evalLogPath); } catch { /* ignore */ }

  return {
    caseId: evalCase.id,
    prompt: evalCase.prompt,
    triggered,
    expectedTrigger: evalCase.expectedTrigger,
    triggerMatch,
    falsePositive,
    recallDocs,
    claudeResponse: claudeResponse.slice(0, 5000), // Limit stored response size
    scores,
    scoreError,
    elapsedMs: elapsed,
    recallMs,
    error,
  };
}

/**
 * Run all eval cases and produce a report.
 */
export async function runEval(options: {
  casesPath: string;
  recallEnabled: boolean;
  strategy: string;
  timeout: number;
  outputPath?: string;
  caseFilter?: string;
  skipScoring?: boolean;
}): Promise<EvalReport> {
  let cases = loadCases(options.casesPath);

  // Apply filter
  if (options.caseFilter) {
    const filter = options.caseFilter.toLowerCase();
    cases = cases.filter((c) =>
      c.id.toLowerCase().includes(filter) || c.description.toLowerCase().includes(filter)
    );
  }

  console.log(`\n🧪 Running recall evaluation (${cases.length} cases)...\n`);

  const results: RunResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];
    console.log(`[${i + 1}/${cases.length}] ${evalCase.id}`);

    // Clean session cache between cases
    cleanupSessionCache();

    const result = await runCase(evalCase, {
      recallEnabled: options.recallEnabled,
      strategy: options.strategy,
      timeout: options.timeout,
      skipScoring: options.skipScoring,
    });

    results.push(result);

    // Print per-case summary
    if (result.error) {
      console.log(`  ❌ Error: ${result.error}`);
    } else {
      const triggerIcon = result.triggerMatch ? '✅' : '❌';
      console.log(`  Trigger: ${triggerIcon} (expected: ${result.expectedTrigger ? 'yes' : 'no'})`);
      if (result.triggered) {
        console.log(`  Recall:  ${result.recallDocs.length} docs`);
        if (result.scores) {
          console.log(`  Scores:  relevance=${result.scores.relevance} adoption=${result.scores.adoption} usefulness=${result.scores.usefulness}`);
        }
      }
      console.log(`  Time:    ${(result.elapsedMs / 1000).toFixed(1)}s${result.recallMs !== null ? ` (recall: ${result.recallMs}ms)` : ''}`);
    }
    console.log('');
  }

  const summary = computeSummary(results);

  const report: EvalReport = {
    version: 1,
    runAt: new Date().toISOString(),
    strategy: options.strategy,
    scorerVersion: SCORER_VERSION,
    recallEnabled: options.recallEnabled,
    cases: results,
    summary,
  };

  // Print summary
  console.log(formatSingleReport(results, options.strategy));

  // Save results file
  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, JSON.stringify(report, null, 2));
    console.log(`\n📁 Full results: ${options.outputPath}`);
  }

  return report;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/eval/runner.ts src/__tests__/eval-runner.test.ts
git commit -m "feat(eval): add eval runner with claude -p execution engine"
```

---

### Task 7: Register CLI command and create test cases

**Files:**
- Modify: `src/index.ts` (add `eval-recall` command registration)
- Create: `eval/recall-cases.yaml`
- Create: `eval/results/.gitignore`

- [ ] **Step 1: Register the eval-recall command**

In `src/index.ts`, add after the existing `auto-recall` command block (around line 431):

```typescript
program
  .command('eval-recall')
  .description('Evaluate auto-recall quality with test cases')
  .option('--cases <path>', 'Path to test cases YAML', 'eval/recall-cases.yaml')
  .option('--output <path>', 'Output results JSON path')
  .option('--strategy <name>', 'Search strategy name', 'keyword-v1')
  .option('--no-recall', 'Run with recall disabled (for A/B baseline)')
  .option('--timeout <ms>', 'Timeout per case in ms', '60000')
  .option('--case <id>', 'Run only cases matching this filter')
  .option('--no-scoring', 'Skip LLM scoring (faster, for debugging)')
  .option('--compare <paths...>', 'Compare two result JSON files')
  .action(async (cmdOpts) => {
    if (cmdOpts.compare && cmdOpts.compare.length === 2) {
      const { compareReports, formatCompareReport } = await import('./eval/compare.js');
      const fs = await import('node:fs');
      const a = JSON.parse(fs.readFileSync(cmdOpts.compare[0], 'utf-8'));
      const b = JSON.parse(fs.readFileSync(cmdOpts.compare[1], 'utf-8'));
      const diff = compareReports(a, b);
      console.log(formatCompareReport(diff));
      return;
    }

    const { runEval } = await import('./eval/runner.js');
    await runEval({
      casesPath: cmdOpts.cases,
      recallEnabled: cmdOpts.recall !== false,
      strategy: cmdOpts.strategy,
      timeout: parseInt(cmdOpts.timeout, 10),
      outputPath: cmdOpts.output,
      caseFilter: cmdOpts.case,
      skipScoring: cmdOpts.scoring === false,
    });
  });
```

- [ ] **Step 2: Create test cases file**

Create `eval/recall-cases.yaml`:

```yaml
version: 1
cases:
  # ─── Positive cases: should trigger recall ─────────────

  - id: bash-error-modulenotfound
    description: "Python import 报错"
    prompt: "我在运行 sglang 服务时遇到了 ModuleNotFoundError: No module named 'sglang.srt'，怎么解决？"
    expectedTrigger: true
    expectedTopics: ["sglang", "import"]

  - id: bash-error-oom
    description: "GPU OOM 场景"
    prompt: "K8s pod 被 OOMKilled 了，日志里看到 CUDA out of memory，怎么排查？"
    expectedTrigger: true
    expectedTopics: ["OOM", "GPU"]

  - id: grep-fuse-config
    description: "FUSE 端口冲突"
    prompt: "帮我查一下 FUSE 部署时端口冲突的问题，之前部署时遇到过"
    expectedTrigger: true
    expectedTopics: ["FUSE", "端口"]

  - id: api-timeout
    description: "API 超时配置"
    prompt: "SGLang API 请求经常超时，默认 timeout 30 秒不够用，怎么调？"
    expectedTrigger: true
    expectedTopics: ["timeout", "sglang", "api"]

  - id: kubectl-exec-timeout
    description: "kubectl exec 长任务超时"
    prompt: "kubectl exec 执行长时间命令总是断开，有什么解决方案？"
    expectedTrigger: true
    expectedTopics: ["kubectl", "exec", "timeout"]

  - id: sglang-router-traffic
    description: "SGLang router 流量不均"
    prompt: "SGLang router cache-aware 策略下流量分配不均匀是怎么回事？"
    expectedTrigger: true
    expectedTopics: ["sglang", "router", "cache-aware"]

  # ─── Negative cases: should NOT trigger recall ─────────

  - id: negative-hello-world
    description: "普通编码任务"
    prompt: "帮我写一个 Python hello world 脚本"
    expectedTrigger: false

  - id: negative-git-status
    description: "简单 git 操作"
    prompt: "帮我看一下 git status"
    expectedTrigger: false
```

- [ ] **Step 3: Create results .gitignore**

Create `eval/results/.gitignore`:

```
*
!.gitignore
```

- [ ] **Step 4: Build and verify command registers**

Run: `cd /data/sglang-proj/team-ai-cli && npx tsup && node dist/index.js eval-recall --help`
Expected: Shows eval-recall usage with all options

- [ ] **Step 5: Commit**

```bash
git add src/index.ts eval/recall-cases.yaml eval/results/.gitignore
git commit -m "feat(eval): register eval-recall CLI command and add test cases"
```

---

### Task 8: Integration smoke test

**Files:**
- None new — this task verifies the full pipeline works

- [ ] **Step 1: Run all unit tests**

Run: `cd /data/sglang-proj/team-ai-cli && npx vitest run src/__tests__/eval-*.test.ts`
Expected: ALL PASS

- [ ] **Step 2: Build the project**

Run: `cd /data/sglang-proj/team-ai-cli && npx tsup`
Expected: Build succeeds with no errors

- [ ] **Step 3: Smoke test with a single case (no scoring)**

Run: `cd /data/sglang-proj/team-ai-cli && node dist/index.js eval-recall --case api-timeout --no-scoring --timeout 90000`
Expected: Runs one case, shows trigger status and timing. No LLM scoring (to avoid API cost during testing).

- [ ] **Step 4: Smoke test with scoring (one case)**

Run: `cd /data/sglang-proj/team-ai-cli && node dist/index.js eval-recall --case api-timeout --output eval/results/smoke-test.json`
Expected: Runs one case with LLM scoring, saves JSON result.

- [ ] **Step 5: Verify A/B compare works**

Run: `cd /data/sglang-proj/team-ai-cli && node dist/index.js eval-recall --compare eval/results/smoke-test.json eval/results/smoke-test.json`
Expected: Shows comparison with all deltas = 0 (comparing same file).

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(eval): complete auto-recall eval harness v1"
```

---

## Dependency Graph

```
Task 1 (types) ─────────┬──→ Task 3 (parser) ──┐
                         ├──→ Task 4 (scorer) ──┤
                         └──→ Task 5 (report) ──┤
                                                ├──→ Task 6 (runner) ──→ Task 7 (CLI) ──→ Task 8 (smoke)
Task 2 (auto-recall mod) ──────────────────────┘
```

Tasks 1 and 2 can run in parallel.
Tasks 3, 4, 5 can run in parallel (all depend only on Task 1).
Task 6 depends on Tasks 2-5.
Tasks 7, 8 are sequential.
