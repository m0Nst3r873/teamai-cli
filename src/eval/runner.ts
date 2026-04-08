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

    const escaped = prompt.replace(/'/g, "'\\''");
    return `${envVars.join(' ')} claude -p '${escaped}' --verbose 2>&1`;
}

/**
 * Process raw claude output + eval log into structured data.
 */
export function processRunOutput(
    stdout: string,
    evalLogPath: string,
): {
    claudeResponse: string;
    evalEntries: EvalLogEntry[];
    triggered: boolean;
    recallDocs: Array<{ rank: number; title: string; filename: string; score: number }>;
} {
    let evalEntries: EvalLogEntry[] = [];
    try {
        const logContent = fs.readFileSync(evalLogPath, 'utf-8');
        evalEntries = parseEvalLog(logContent);
    } catch {
        // Log file may not exist if recall didn't trigger
    }

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
 * Run a single eval case.
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
            maxBuffer: 1024 * 1024,
        });
    } catch (err) {
        if (err instanceof Error) {
            error = err.message.slice(0, 200);
            stdout = (err as { stdout?: string }).stdout ?? '';
        }
    }

    const elapsed = Date.now() - start;
    const { claudeResponse, evalEntries, triggered, recallDocs } = processRunOutput(stdout, evalLogPath);

    const triggerMatch = triggered === evalCase.expectedTrigger;
    const falsePositive = !evalCase.expectedTrigger && triggered;

    const recallMs = evalEntries.length > 0 ? evalEntries[evalEntries.length - 1].searchMs : null;

    let scores = null;
    let scoreError: string | null = null;

    if (!options.skipScoring && triggered && recallDocs.length > 0) {
        const scoringDocs = recallDocs.map((d) => ({
            title: d.title,
            tags: [] as string[],
            filename: d.filename,
            score: d.score,
        }));
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

    try { fs.unlinkSync(evalLogPath); } catch { /* ignore */ }

    return {
        caseId: evalCase.id,
        prompt: evalCase.prompt,
        triggered,
        expectedTrigger: evalCase.expectedTrigger,
        triggerMatch,
        falsePositive,
        recallDocs,
        claudeResponse: claudeResponse.slice(0, 5000),
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

        cleanupSessionCache();

        const result = await runCase(evalCase, {
            recallEnabled: options.recallEnabled,
            strategy: options.strategy,
            timeout: options.timeout,
            skipScoring: options.skipScoring,
        });

        results.push(result);

        if (result.error) {
            console.log(`  ❌ Error: ${result.error}`);
        } else {
            const triggerIcon = result.triggerMatch ? '✅' : '❌';
            console.log(`  Trigger: ${triggerIcon} (expected: ${result.expectedTrigger ? 'yes' : 'no'})`);
            if (result.triggered) {
                console.log(`  Recall:  ${result.recallDocs.length} docs`);
                if (result.scores) {
                    console.log(
                        `  Scores:  relevance=${result.scores.relevance} adoption=${result.scores.adoption} usefulness=${result.scores.usefulness}`
                    );
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

    console.log(formatSingleReport(results, options.strategy));

    if (options.outputPath) {
        fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
        fs.writeFileSync(options.outputPath, JSON.stringify(report, null, 2));
        console.log(`\n📁 Full results: ${options.outputPath}`);
    }

    return report;
}
