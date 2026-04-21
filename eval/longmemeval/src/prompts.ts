/**
 * Exact prompts used for answer generation and judging.
 * Keep these stable across runs — any change invalidates comparability.
 */

export const ANSWER_SYSTEM_PROMPT = `You are answering a question about a user's past conversations. You have access to "memories" — short excerpts retrieved from those prior conversations. Answer concisely and factually based only on the provided memories. If the memories don't contain the answer, say "I don't know" rather than guessing.`

export function buildAnswerUserPrompt(question: string, memories: string[]): string {
  const memoryBlock =
    memories.length === 0
      ? '(no memories retrieved)'
      : memories.map((m, i) => `[${i + 1}] ${m}`).join('\n')
  return `Memories from prior conversations:\n${memoryBlock}\n\nQuestion: ${question}\n\nAnswer:`
}

export const JUDGE_SYSTEM_PROMPT = `You are an impartial judge comparing a candidate answer to a ground-truth answer. Output exactly "correct" if the candidate answer conveys the same factual content as the ground truth (wording may differ). Output "incorrect" otherwise. Output nothing else.`

export function buildJudgeUserPrompt(
  question: string,
  groundTruth: string,
  candidate: string,
): string {
  return `Question: ${question}\n\nGround truth: ${groundTruth}\n\nCandidate: ${candidate}\n\nVerdict:`
}
