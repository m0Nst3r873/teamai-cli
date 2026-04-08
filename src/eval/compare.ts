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
  return Math.round(n * 1000) / 1000;
}

export function formatCompareReport(diff: CompareResult): string {
  const lines: string[] = [];
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

  lines.push('📊 Strategy Comparison');
  lines.push('━'.repeat(50));
  lines.push(`  Strategy A:         ${diff.strategyA}`);
  lines.push(`  Strategy B:         ${diff.strategyB}`);
  lines.push(`  Hit rate:           ${(diff.hitRateA * 100).toFixed(1)}% → ${(diff.hitRateB * 100).toFixed(1)}% (${sign(round(diff.hitRateDelta * 100))}%)`);
  lines.push(`  Relevance delta:    ${sign(diff.relevanceDelta)}`);
  lines.push(`  Adoption delta:     ${sign(diff.adoptionDelta)}`);
  lines.push(`  Usefulness delta:   ${sign(diff.usefulnessDelta)}`);
  if (diff.recallTimeDelta !== null) {
    lines.push(`  Recall time delta:  ${sign(diff.recallTimeDelta)}ms`);
  }

  return lines.join('\n');
}
