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
