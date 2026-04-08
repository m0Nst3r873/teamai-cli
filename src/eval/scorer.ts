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
        return {
            score: retryScore,
            error: retryScore
                ? null
                : `Failed to parse scorer output after retry: ${retryText.slice(0, 100)}`,
        };
    } catch (err) {
        return {
            score: null,
            error: `Anthropic API error: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
