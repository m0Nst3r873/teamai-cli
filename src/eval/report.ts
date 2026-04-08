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
