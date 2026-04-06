import type { Memory } from '@tages/shared'

// Estimate tokens: ~4 chars per token (conservative for English text)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Given ranked memories and a token budget, return as many as fit
export function budgetedResults(
  memories: Memory[],
  maxTokens: number,
  formatFn: (m: Memory) => string,
): Memory[] {
  let used = 0
  const result: Memory[] = []
  for (const m of memories) {
    const formatted = formatFn(m)
    const tokens = estimateTokens(formatted)
    if (used + tokens > maxTokens) break
    used += tokens
    result.push(m)
  }
  return result
}
