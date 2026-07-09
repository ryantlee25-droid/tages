/**
 * Exact prompts used for answer generation and judging.
 * Keep these stable across runs — any change invalidates comparability.
 *
 * EVAL-ONLY: everything in this file feeds the harness's synthetic GPT-4o
 * reader/judge (see eval/longmemeval/src/answer.ts). It has no effect on the
 * shipped `recall`/`remember` MCP tools or CLI — those ship with no LLM in
 * the loop. Do not port these prompts into packages/server or packages/cli.
 */
import type { QuestionType } from './types.js'

// ---------------------------------------------------------------------------
// Answer generation (Tasks 2 and 5)
// ---------------------------------------------------------------------------

const BASE_ANSWER_INSTRUCTIONS = `You are answering a question about a user's past conversations. You have access to "memories" — short excerpts retrieved from those prior conversations. Answer concisely and factually based only on the provided memories. If the memories don't contain the answer, say "I don't know" rather than guessing.`

const PREFERENCE_ANSWER_INSTRUCTIONS = `You are answering a question about a user's stated preferences, based on "memories" — short excerpts retrieved from prior conversations. Instead of giving a single factual answer, describe the preference(s) the user has expressed and how a response to them should be tailored to match those preferences. Base your description only on the provided memories. If the memories don't contain any relevant preference, say "I don't know" rather than guessing.`

const DATE_ARITHMETIC_INSTRUCTIONS = `When the question requires date arithmetic (e.g. "how many days ago was X", "what date will it be N days after Y"), compute the exact answer using the dates given in the memories and the question's reference date if one is provided. Work the arithmetic out precisely; only state the final computed answer.`

const NUMERIC_AGGREGATION_INSTRUCTIONS = `When the question requires numeric aggregation (e.g. summing costs or totals mentioned across multiple memories, counting occurrences, ordering events), add up or order all relevant figures from the memories precisely before answering. Do not drop or approximate a figure that appears in the memories.`

const CHAIN_OF_NOTE_INSTRUCTIONS = `Before answering, first write brief relevance notes under a line labeled "NOTES:" — for each numbered memory, note in one short line whether it is relevant to the question and, if so, what fact it contributes. Then, on a new line labeled "ANSWER:", write your final answer conditioned only on those notes and the memories. If nothing relevant was found in the notes, the answer should be "I don't know" rather than a guess.`

/** Factual/default answer prompt: date-arithmetic, numeric-aggregation, and Chain-of-Note instructions. */
export const ANSWER_SYSTEM_PROMPT = [
  BASE_ANSWER_INSTRUCTIONS,
  DATE_ARITHMETIC_INSTRUCTIONS,
  NUMERIC_AGGREGATION_INSTRUCTIONS,
  CHAIN_OF_NOTE_INSTRUCTIONS,
].join('\n\n')

/** Preference-response mode: rubric-style answer instead of single factual answer, plus Chain-of-Note. */
export const ANSWER_SYSTEM_PROMPT_PREFERENCE = [
  PREFERENCE_ANSWER_INSTRUCTIONS,
  CHAIN_OF_NOTE_INSTRUCTIONS,
].join('\n\n')

/** Task 2: select the answer-generation system prompt for a question type. */
export function buildAnswerSystemPrompt(questionType: QuestionType): string {
  return questionType === 'single-session-preference'
    ? ANSWER_SYSTEM_PROMPT_PREFERENCE
    : ANSWER_SYSTEM_PROMPT
}

export function buildAnswerUserPrompt(question: string, memories: string[]): string {
  const memoryBlock =
    memories.length === 0
      ? '(no memories retrieved)'
      : memories.map((m, i) => `[${i + 1}] ${m}`).join('\n')
  return `Memories from prior conversations:\n${memoryBlock}\n\nQuestion: ${question}\n\nAnswer:`
}

/**
 * Task 5: the model is instructed (via CHAIN_OF_NOTE_INSTRUCTIONS above) to emit
 * "NOTES: ...\nANSWER: ..." in a single completion. This extracts the final
 * answer text after the "ANSWER:" marker. Falls back to the full trimmed
 * response if the model didn't follow the marker convention.
 */
export function extractFinalAnswer(raw: string): string {
  const marker = /ANSWER:\s*/i
  const match = marker.exec(raw)
  if (!match) return raw.trim()
  return raw.slice(match.index + match[0].length).trim()
}

// ---------------------------------------------------------------------------
// Judging (Task 1)
// ---------------------------------------------------------------------------

/** Default: factual-equality judge, used for multi-session, knowledge-update, single-session-user/assistant. */
export const JUDGE_SYSTEM_PROMPT = `You are an impartial judge comparing a candidate answer to a ground-truth answer. Output exactly "correct" if the candidate answer conveys the same factual content as the ground truth (wording may differ). Output "incorrect" otherwise. Output nothing else.`

/**
 * single-session-preference: the oracle's "ground truth" field is itself a
 * rubric describing what a satisfactory response should reflect (tone,
 * resource type, tailoring), not a literal factual answer to string-match.
 */
export const JUDGE_SYSTEM_PROMPT_PREFERENCE = `You are an impartial judge evaluating whether a candidate answer satisfies a rubric describing a user's preference. The "ground truth" below is not a literal answer to match verbatim — it is a rubric describing what a satisfactory response should reflect (e.g. tailoring, tone, or type of resource suggested). Output exactly "correct" if the candidate answer's substance satisfies the rubric's intent (wording may differ substantially). Output "incorrect" otherwise. Output nothing else.`

/**
 * Abstention questions (question_id ends "_abs"): judged on whether the
 * candidate correctly declined to answer, regardless of the literal
 * ground-truth text.
 */
export const JUDGE_SYSTEM_PROMPT_ABSTENTION = `You are an impartial judge evaluating whether a candidate answer correctly declines to answer when there is insufficient information in the provided memories. Output exactly "correct" if the candidate indicates it does not know, cannot find the answer, or otherwise declines to guess. Output "incorrect" if the candidate instead asserts a specific answer (even if that answer happens to match some text in the memories — asserting anything at all is the wrong behavior here). Output nothing else.`

/** temporal-reasoning: same factual-equality standard, but off-by-one-day differences are forgiven. */
export const JUDGE_SYSTEM_PROMPT_TEMPORAL = `You are an impartial judge comparing a candidate answer to a ground-truth answer for a date- or time-based question. Output exactly "correct" if the candidate answer conveys the same factual content as the ground truth (wording may differ), ALSO treating an answer that is off by exactly one day (e.g. from inclusive/exclusive day-counting or timezone rounding) as correct. Output "incorrect" for any larger discrepancy. Output nothing else.`

export interface JudgeContext {
  questionType: QuestionType
  isAbstention: boolean
}

/**
 * Task 1: per-type judge branching. Abstention is checked first since it is
 * signaled by question_id suffix, independent of question_type.
 */
export function selectJudgeSystemPrompt(ctx: JudgeContext): string {
  if (ctx.isAbstention) return JUDGE_SYSTEM_PROMPT_ABSTENTION
  if (ctx.questionType === 'single-session-preference') return JUDGE_SYSTEM_PROMPT_PREFERENCE
  if (ctx.questionType === 'temporal-reasoning') return JUDGE_SYSTEM_PROMPT_TEMPORAL
  return JUDGE_SYSTEM_PROMPT
}

export function buildJudgeUserPrompt(
  question: string,
  groundTruth: string,
  candidate: string,
): string {
  return `Question: ${question}\n\nGround truth: ${groundTruth}\n\nCandidate: ${candidate}\n\nVerdict:`
}
