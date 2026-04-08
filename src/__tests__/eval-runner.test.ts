import { describe, it, expect } from 'vitest';
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
    fs.writeFileSync(casesPath, 'version: 1\ncases:\n  - id: test\n    description: test\n    prompt: test prompt\n    expectedTrigger: true\n');
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
