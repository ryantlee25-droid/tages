import OpenAI from 'openai'
import { ANSWER_SYSTEM_PROMPT, buildAnswerUserPrompt, JUDGE_SYSTEM_PROMPT, buildJudgeUserPrompt } from './prompts.js'

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

export async function generateAnswer(
  question: string,
  memories: string[],
): Promise<{ answer: string; cost: LlmCost }> {
  const res = await getClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: ANSWER_SYSTEM_PROMPT },
      { role: 'user', content: buildAnswerUserPrompt(question, memories) },
    ],
  })
  const answer = res.choices[0]?.message?.content?.trim() ?? ''
  const cost: LlmCost = {
    prompt_tokens: res.usage?.prompt_tokens ?? 0,
    completion_tokens: res.usage?.completion_tokens ?? 0,
  }
  return { answer, cost }
}

export async function judge(
  question: string,
  groundTruth: string,
  candidate: string,
): Promise<{ correct: boolean; cost: LlmCost }> {
  const res = await getClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: JUDGE_SYSTEM_PROMPT },
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
