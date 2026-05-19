import { env } from '../env.js';
import type { AIReviewComment } from '@opencoder/shared';

export interface ReviewFile {
  name: string;
  language: string;
  content: string;
}

export interface ReviewRequest {
  language: string;
  files: ReviewFile[];
  question?: { title: string; body: string } | null;
  /** Allows callers (tests, alternate hosts) to override the provider. */
  providerOverride?: 'anthropic' | 'openai' | 'none';
  /** Optional override of base URL (for tests). */
  baseUrlOverride?: string;
}

export interface ReviewResponse {
  provider: 'anthropic' | 'openai' | 'none';
  model: string | null;
  comments: AIReviewComment[];
  rawLatencyMs: number;
}

const SYSTEM_PROMPT = `You are a senior staff engineer reviewing code. Reply ONLY with a JSON object:
{"comments": [{"file": "<filename>", "line": <1-indexed line number>, "severity": "info"|"warn"|"error", "comment": "<concise actionable feedback>"}]}
- Be precise: tie each comment to a specific line in a specific file.
- 5–12 comments unless code is trivial.
- Mark genuine bugs as "error", style/maintainability as "warn", praise/notes as "info".
- Do NOT include prose outside the JSON.`;

function formatPrompt(req: ReviewRequest): string {
  const parts: string[] = [];
  parts.push(`Language: ${req.language}`);
  if (req.question) {
    parts.push(`Interview question — ${req.question.title}\n${req.question.body}`);
  }
  for (const f of req.files) {
    const numbered = f.content
      .split('\n')
      .map((line, i) => `${String(i + 1).padStart(4, ' ')}  ${line}`)
      .join('\n');
    parts.push(`--- ${f.name} (${f.language}) ---\n${numbered}`);
  }
  return parts.join('\n\n');
}

const isReviewComment = (raw: unknown): raw is AIReviewComment => {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.file === 'string' &&
    typeof r.line === 'number' &&
    typeof r.comment === 'string' &&
    (r.severity === 'info' || r.severity === 'warn' || r.severity === 'error')
  );
};

function extractComments(text: string): AIReviewComment[] {
  // Try to find a JSON object in the model output.
  let parsed: unknown = null;
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const m = candidate.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        /* ignore */
      }
    }
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    parsed !== null &&
    Array.isArray((parsed as { comments?: unknown }).comments)
  ) {
    return ((parsed as { comments: unknown[] }).comments.filter(isReviewComment) as AIReviewComment[]).map(
      (c) => ({
        file: c.file,
        line: Math.max(1, Math.floor(c.line)),
        severity: c.severity,
        comment: c.comment.slice(0, 2000),
      }),
    );
  }
  return [];
}

async function callAnthropic(req: ReviewRequest): Promise<{ comments: AIReviewComment[]; model: string }> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('missing_api_key');
  const baseUrl = req.baseUrlOverride ?? 'https://api.anthropic.com/v1/messages';
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: formatPrompt(req) }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic_${res.status}`);
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  return { comments: extractComments(text), model: env.ANTHROPIC_MODEL };
}

async function callOpenAI(req: ReviewRequest): Promise<{ comments: AIReviewComment[]; model: string }> {
  if (!env.OPENAI_API_KEY) throw new Error('missing_api_key');
  const baseUrl = req.baseUrlOverride ?? 'https://api.openai.com/v1/chat/completions';
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: formatPrompt(req) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai_${res.status}`);
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? '';
  return { comments: extractComments(text), model: env.OPENAI_MODEL };
}

export async function runAIReview(req: ReviewRequest): Promise<ReviewResponse> {
  const provider = req.providerOverride ?? env.AI_PROVIDER;
  const start = Date.now();
  if (provider === 'none') {
    return { provider: 'none', model: null, comments: [], rawLatencyMs: 0 };
  }
  try {
    if (provider === 'anthropic') {
      const r = await callAnthropic(req);
      return {
        provider: 'anthropic',
        model: r.model,
        comments: r.comments,
        rawLatencyMs: Date.now() - start,
      };
    }
    if (provider === 'openai') {
      const r = await callOpenAI(req);
      return {
        provider: 'openai',
        model: r.model,
        comments: r.comments,
        rawLatencyMs: Date.now() - start,
      };
    }
  } catch {
    return {
      provider,
      model: null,
      comments: [],
      rawLatencyMs: Date.now() - start,
    };
  }
  return { provider: 'none', model: null, comments: [], rawLatencyMs: 0 };
}

// Exposed for tests:
export const __test__ = { extractComments, formatPrompt };
