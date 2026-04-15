import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseHookEvent,
  readLastAssistantOutput,
  appendEvent,
  readEvents,
  rebuildSessions,
  compactEvents,
} from '../dashboard-collector.js';
import type { DashboardEvent } from '../types.js';

// Use a temp dir for each test to avoid cross-test interference
let tmpDir: string;
let originalHome: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-dashboard-test-'));
  originalHome = process.env.HOME ?? '';
  process.env.HOME = tmpDir;
});

afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── parseHookEvent ─────────────────────────────────────

describe('parseHookEvent', () => {
  it('parses SessionStart event', async () => {
    const raw = JSON.stringify({
      hook_event_name: 'SessionStart',
      session_id: 'sess-123',
      cwd: '/home/jeff/project',
    });
    const event = await parseHookEvent(raw, 'claude');
    expect(event).not.toBeNull();
    expect(event!.type).toBe('session_start');
    expect(event!.sessionId).toBe('sess-123');
    expect(event!.tool).toBe('claude');
    expect(event!.cwd).toBe('/home/jeff/project');
  });

  it('parses PostToolUse event with tool_name', async () => {
    const raw = JSON.stringify({
      hook_event_name: 'PostToolUse',
      session_id: 'sess-123',
      tool_name: 'Edit',
      cwd: '/home/jeff/project',
    });
    const event = await parseHookEvent(raw, 'claude');
    expect(event!.type).toBe('tool_use');
    expect(event!.toolName).toBe('Edit');
  });

  it('parses UserPromptSubmit event with prompt', async () => {
    const raw = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-123',
      prompt: 'Fix the login bug in auth.ts',
    });
    const event = await parseHookEvent(raw, 'claude-internal');
    expect(event!.type).toBe('prompt_submit');
    expect(event!.promptSummary).toBe('Fix the login bug in auth.ts');
    expect(event!.tool).toBe('claude-internal');
  });

  it('truncates long prompts to 200 chars', async () => {
    const longPrompt = 'x'.repeat(500);
    const raw = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-123',
      prompt: longPrompt,
    });
    const event = await parseHookEvent(raw, 'claude');
    expect(event!.promptSummary!.length).toBe(200);
  });

  it('parses Stop event', async () => {
    const raw = JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'sess-123',
    });
    const event = await parseHookEvent(raw, 'claude');
    expect(event!.type).toBe('stop');
  });

  it('returns null for empty input', async () => {
    expect(await parseHookEvent('', 'claude')).toBeNull();
    expect(await parseHookEvent('   ', 'claude')).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    expect(await parseHookEvent('not json', 'claude')).toBeNull();
  });

  it('parses Cursor camelCase sessionStart event', async () => {
    const raw = JSON.stringify({
      hook_event_name: 'sessionStart',
      session_id: 'sess-cursor-1',
      cwd: '/home/jeff/project',
    });
    const event = await parseHookEvent(raw, 'cursor');
    expect(event).not.toBeNull();
    expect(event!.type).toBe('session_start');
    expect(event!.sessionId).toBe('sess-cursor-1');
    expect(event!.tool).toBe('cursor');
  });

  it('parses Cursor camelCase stop event', async () => {
    const raw = JSON.stringify({
      hook_event_name: 'stop',
      session_id: 'sess-cursor-2',
    });
    const event = await parseHookEvent(raw, 'cursor');
    expect(event!.type).toBe('stop');
  });

  it('parses Cursor camelCase postToolUse event', async () => {
    const raw = JSON.stringify({
      hook_event_name: 'postToolUse',
      session_id: 'sess-cursor-3',
      tool_name: 'Read',
    });
    const event = await parseHookEvent(raw, 'cursor');
    expect(event!.type).toBe('tool_use');
    expect(event!.toolName).toBe('Read');
  });

  it('parses Cursor beforeSubmitPrompt event', async () => {
    const raw = JSON.stringify({
      hook_event_name: 'beforeSubmitPrompt',
      session_id: 'sess-cursor-4',
      prompt: 'Fix the bug in auth.ts',
    });
    const event = await parseHookEvent(raw, 'cursor');
    expect(event!.type).toBe('prompt_submit');
    expect(event!.promptSummary).toBe('Fix the bug in auth.ts');
  });

  it('returns null for unknown hook event', async () => {
    const raw = JSON.stringify({
      hook_event_name: 'UnknownEvent',
      session_id: 'sess-123',
    });
    expect(await parseHookEvent(raw, 'claude')).toBeNull();
  });

  it('falls back to PID+cwd when session_id missing', async () => {
    const raw = JSON.stringify({
      hook_event_name: 'SessionStart',
      cwd: '/home/jeff/project',
    });
    const event = await parseHookEvent(raw, 'claude');
    expect(event!.sessionId).toMatch(/^pid-\d+-\/home\/jeff\/project$/);
  });

  it('uses CLAUDE_SESSION_ID env as fallback', async () => {
    process.env.CLAUDE_SESSION_ID = 'env-sess-456';
    try {
      const raw = JSON.stringify({
        hook_event_name: 'SessionStart',
        cwd: '/home/jeff/project',
      });
      const event = await parseHookEvent(raw, 'claude');
      expect(event!.sessionId).toBe('env-sess-456');
    } finally {
      delete process.env.CLAUDE_SESSION_ID;
    }
  });

  it('captures stoppedOutput from transcript_path', async () => {
    // Create a mock transcript file
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const transcriptLines = [
      JSON.stringify({ type: 'human', message: { content: [{ type: 'text', text: 'Hello' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'AI response here' }] } }),
    ];
    fs.writeFileSync(transcriptPath, transcriptLines.join('\n') + '\n');

    const raw = JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'sess-transcript',
      transcript_path: transcriptPath,
    });
    const event = await parseHookEvent(raw, 'claude');
    expect(event!.type).toBe('stop');
    expect(event!.stoppedOutput).toBe('AI response here');
    expect(event!.transcriptPath).toBe(transcriptPath);
  });
});

// ─── readLastAssistantOutput ──────────────────────────────

describe('readLastAssistantOutput', () => {
  it('reads last assistant message from transcript', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const lines = [
      JSON.stringify({ type: 'human', message: { content: [{ type: 'text', text: 'Hello' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'First response' }] } }),
      JSON.stringify({ type: 'human', message: { content: [{ type: 'text', text: 'Follow up' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Final response' }] } }),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const output = await readLastAssistantOutput(transcriptPath);
    expect(output).toBe('Final response');
  });

  it('returns empty string for nonexistent file', async () => {
    const output = await readLastAssistantOutput('/nonexistent/path/transcript.jsonl');
    expect(output).toBe('');
  });

  it('returns empty string for empty file', async () => {
    const transcriptPath = path.join(tmpDir, 'empty.jsonl');
    fs.writeFileSync(transcriptPath, '');
    const output = await readLastAssistantOutput(transcriptPath);
    expect(output).toBe('');
  });

  it('truncates output to 500 chars', async () => {
    const transcriptPath = path.join(tmpDir, 'long.jsonl');
    const longText = 'x'.repeat(1000);
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: longText }] } });
    fs.writeFileSync(transcriptPath, line + '\n');

    const output = await readLastAssistantOutput(transcriptPath);
    expect(output.length).toBe(500);
  });

  it('skips malformed lines gracefully', async () => {
    const transcriptPath = path.join(tmpDir, 'malformed.jsonl');
    const lines = [
      'NOT JSON',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Valid response' }] } }),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const output = await readLastAssistantOutput(transcriptPath);
    expect(output).toBe('Valid response');
  });
});

// ─── JSONL persistence ──────────────────────────────────

describe('appendEvent / readEvents', () => {
  it('appends and reads events', async () => {
    const event: DashboardEvent = {
      type: 'session_start',
      timestamp: '2026-03-24T22:00:00Z',
      sessionId: 'sess-001',
      tool: 'claude',
      cwd: '/home/jeff/project',
    };
    await appendEvent(event);
    await appendEvent({ ...event, type: 'tool_use', toolName: 'Edit' });

    const eventsPath = path.join(tmpDir, '.teamai', 'dashboard', 'events.jsonl');
    const events = await readEvents(eventsPath);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('session_start');
    expect(events[1].toolName).toBe('Edit');
  });

  it('returns empty array when file does not exist', async () => {
    const events = await readEvents('/nonexistent/path/events.jsonl');
    expect(events).toEqual([]);
  });

  it('skips corrupted lines', async () => {
    const eventsPath = path.join(tmpDir, '.teamai', 'dashboard', 'events.jsonl');
    fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
    fs.writeFileSync(eventsPath, [
      JSON.stringify({ type: 'session_start', timestamp: 'T1', sessionId: 's1', tool: 'claude' }),
      'CORRUPTED LINE',
      JSON.stringify({ type: 'stop', timestamp: 'T2', sessionId: 's1', tool: 'claude' }),
    ].join('\n') + '\n');

    const events = await readEvents(eventsPath);
    expect(events).toHaveLength(2);
  });
});

// ─── rebuildSessions ────────────────────────────────────

describe('rebuildSessions', () => {
  const now = new Date().toISOString();

  it('creates session from session_start event', () => {
    const events: DashboardEvent[] = [
      { type: 'session_start', timestamp: now, sessionId: 's1', tool: 'claude', cwd: '/proj' },
    ];
    const sessions = rebuildSessions(events);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('running');
    expect(sessions[0].cwd).toBe('/proj');
  });

  it('updates session on tool_use', () => {
    const events: DashboardEvent[] = [
      { type: 'session_start', timestamp: now, sessionId: 's1', tool: 'claude', cwd: '/proj' },
      { type: 'tool_use', timestamp: now, sessionId: 's1', tool: 'claude', toolName: 'Bash' },
    ];
    const sessions = rebuildSessions(events);
    expect(sessions[0].lastTool).toBe('Bash');
    expect(sessions[0].status).toBe('running');
  });

  it('captures first prompt as summary', () => {
    const events: DashboardEvent[] = [
      { type: 'session_start', timestamp: now, sessionId: 's1', tool: 'claude', cwd: '/proj' },
      { type: 'prompt_submit', timestamp: now, sessionId: 's1', tool: 'claude', promptSummary: 'Fix the bug' },
      { type: 'prompt_submit', timestamp: now, sessionId: 's1', tool: 'claude', promptSummary: 'Second prompt' },
    ];
    const sessions = rebuildSessions(events);
    expect(sessions[0].promptSummary).toBe('Fix the bug');
  });

  it('keeps recently stopped sessions for 30 seconds', () => {
    const events: DashboardEvent[] = [
      { type: 'session_start', timestamp: now, sessionId: 's1', tool: 'claude', cwd: '/proj' },
      { type: 'stop', timestamp: now, sessionId: 's1', tool: 'claude' },
    ];
    const sessions = rebuildSessions(events);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('stopped');
  });

  it('removes stopped sessions after 30 seconds', () => {
    const oldTime = new Date(Date.now() - 35 * 1000).toISOString(); // 35 sec ago
    const events: DashboardEvent[] = [
      { type: 'session_start', timestamp: oldTime, sessionId: 's1', tool: 'claude', cwd: '/proj' },
      { type: 'stop', timestamp: oldTime, sessionId: 's1', tool: 'claude' },
    ];
    const sessions = rebuildSessions(events);
    expect(sessions).toHaveLength(0);
  });

  it('collects all prompts in session', () => {
    const events: DashboardEvent[] = [
      { type: 'session_start', timestamp: now, sessionId: 's1', tool: 'claude', cwd: '/proj' },
      { type: 'prompt_submit', timestamp: now, sessionId: 's1', tool: 'claude', promptSummary: 'First prompt' },
      { type: 'prompt_submit', timestamp: now, sessionId: 's1', tool: 'claude', promptSummary: 'Second prompt' },
    ];
    const sessions = rebuildSessions(events);
    expect(sessions[0].prompts).toEqual(['First prompt', 'Second prompt']);
    expect(sessions[0].promptSummary).toBe('First prompt');
  });

  it('captures stoppedOutput from stop event', () => {
    const events: DashboardEvent[] = [
      { type: 'session_start', timestamp: now, sessionId: 's1', tool: 'claude', cwd: '/proj' },
      { type: 'stop', timestamp: now, sessionId: 's1', tool: 'claude', stoppedOutput: 'AI final output' },
    ];
    const sessions = rebuildSessions(events);
    expect(sessions[0].stoppedOutput).toBe('AI final output');
  });

  it('sorts active sessions before stopped sessions', () => {
    const events: DashboardEvent[] = [
      { type: 'session_start', timestamp: now, sessionId: 's1', tool: 'claude', cwd: '/proj' },
      { type: 'stop', timestamp: now, sessionId: 's1', tool: 'claude' },
      { type: 'session_start', timestamp: now, sessionId: 's2', tool: 'claude', cwd: '/proj2' },
    ];
    const sessions = rebuildSessions(events);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).toBe('s2'); // active first
    expect(sessions[1].sessionId).toBe('s1'); // stopped last
  });

  it('marks idle sessions after timeout', () => {
    const oldTime = new Date(Date.now() - 6 * 60 * 1000).toISOString(); // 6 min ago
    const events: DashboardEvent[] = [
      { type: 'session_start', timestamp: oldTime, sessionId: 's1', tool: 'claude', cwd: '/proj' },
    ];
    const sessions = rebuildSessions(events);
    expect(sessions[0].status).toBe('idle');
  });

  it('removes stale sessions after 30 min', () => {
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // 31 min ago
    const events: DashboardEvent[] = [
      { type: 'session_start', timestamp: staleTime, sessionId: 's1', tool: 'claude', cwd: '/proj' },
    ];
    const sessions = rebuildSessions(events);
    expect(sessions).toHaveLength(0);
  });

  it('handles multiple concurrent sessions', () => {
    const events: DashboardEvent[] = [
      { type: 'session_start', timestamp: now, sessionId: 's1', tool: 'claude', cwd: '/proj-a' },
      { type: 'session_start', timestamp: now, sessionId: 's2', tool: 'claude-internal', cwd: '/proj-b' },
      { type: 'tool_use', timestamp: now, sessionId: 's1', tool: 'claude', toolName: 'Edit' },
    ];
    const sessions = rebuildSessions(events);
    expect(sessions).toHaveLength(2);
    const s1 = sessions.find(s => s.sessionId === 's1');
    const s2 = sessions.find(s => s.sessionId === 's2');
    expect(s1!.cwd).toBe('/proj-a');
    expect(s2!.cwd).toBe('/proj-b');
  });

  it('sorts by lastActivity descending', () => {
    const t1 = new Date(Date.now() - 60000).toISOString();
    const t2 = new Date().toISOString();
    const events: DashboardEvent[] = [
      { type: 'session_start', timestamp: t1, sessionId: 's1', tool: 'claude', cwd: '/proj-a' },
      { type: 'session_start', timestamp: t2, sessionId: 's2', tool: 'claude', cwd: '/proj-b' },
    ];
    const sessions = rebuildSessions(events);
    expect(sessions[0].sessionId).toBe('s2');
  });
});

// ─── compactEvents ──────────────────────────────────────

describe('compactEvents', () => {
  it('does not compact when below threshold', async () => {
    const eventsPath = path.join(tmpDir, '.teamai', 'dashboard', 'events.jsonl');
    fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
    const event = { type: 'session_start', timestamp: new Date().toISOString(), sessionId: 's1', tool: 'claude' };
    fs.writeFileSync(eventsPath, JSON.stringify(event) + '\n');

    await compactEvents(eventsPath);

    const content = fs.readFileSync(eventsPath, 'utf-8');
    expect(content.trim().split('\n')).toHaveLength(1);
  });
});
