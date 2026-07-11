import OpenAI from 'openai'
import {
  buildAnswerSystemPrompt,
  buildAnswerUserPrompt,
  buildJudgeUserPrompt,
  extractFinalAnswer,
  selectJudgeSystemPrompt,
} from './prompts.js'
import type { QuestionType } from './types.js'

const MODEL = 'gpt-4o-2024-08-06'

let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!client) {
    const key = process.env.OPENAI_API_KEY
    if (!key) throw new Error('OPENAI_API_KEY is not set')
    client = new OpenAI({ apiKey: key })
  }
  return client
}

export interface LlmCost {
  prompt_tokens: number
  completion_tokens: number
}

/**
 * EVAL-ONLY synthetic reader. Generates an answer for the harness's judge to
 * score. `questionType` selects the type-aware prompt (Task 2: date
 * arithmetic / numeric aggregation / preference-response mode) and every
 * prompt variant includes the Chain-of-Note "NOTES: ... ANSWER: ..."
 * structure (Task 5); `extractFinalAnswer` strips the notes back out so
 * callers only see the final answer text. `referenceDate` (Task 1: the
 * question's `question_date`) is forwarded to `buildAnswerUserPrompt` as the
 * reader's "today" anchor for relative-date arithmetic; omitted, prompt
 * construction is unchanged from before this task.
 */
export async function generateAnswer(
  question: string,
  memories: string[],
  questionType: QuestionType,
  referenceDate?: string,
): Promise<{ answer: string; cost: LlmCost }> {
  const res = await getClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: buildAnswerSystemPrompt(questionType) },
      { role: 'user', content: buildAnswerUserPrompt(question, memories, referenceDate) },
    ],
  })
  const raw = res.choices[0]?.message?.content?.trim() ?? ''
  const answer = extractFinalAnswer(raw)
  const cost: LlmCost = {
    prompt_tokens: res.usage?.prompt_tokens ?? 0,
    completion_tokens: res.usage?.completion_tokens ?? 0,
  }
  return { answer, cost }
}

/**
 * Task 1: per-type judge branching.
 * - `single-session-preference` is judged against the oracle's rubric text, not factual equality.
 * - Abstention questions (`isAbstention`, i.e. `question_id` ends `_abs`) are judged on whether
 *   the candidate correctly declined to answer, regardless of literal ground-truth text.
 * - `temporal-reasoning` allows off-by-one-day tolerance.
 * - All other types keep the original factual-equality standard.
 */
export async function judge(
  question: string,
  groundTruth: string,
  candidate: string,
  questionType: QuestionType,
  isAbstention: boolean,
): Promise<{ correct: boolean; cost: LlmCost }> {
  const systemPrompt = selectJudgeSystemPrompt({ questionType, isAbstention })
  const res = await getClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildJudgeUserPrompt(question, groundTruth, candidate) },
    ],
  })
  const verdict = res.choices[0]?.message?.content?.trim().toLowerCase() ?? ''
  const cost: LlmCost = {
    prompt_tokens: res.usage?.prompt_tokens ?? 0,
    completion_tokens: res.usage?.completion_tokens ?? 0,
  }
  return { correct: verdict.startsWith('correct'), cost }
}

// GPT-4o published pricing (2026-04): $2.50 / 1M prompt, $10.00 / 1M completion.
export function estimateCostUsd(totals: LlmCost): number {
  return (totals.prompt_tokens / 1_000_000) * 2.5 + (totals.completion_tokens / 1_000_000) * 10.0
}
