import type { MemoryType } from '@tages/shared'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `You rewrite AI agent memory entries into imperative form. Rules:
- Start with ALWAYS, NEVER, MUST, or DO NOT
- Keep it one sentence
- Preserve all specific identifiers (file paths, function names, import paths)
- No prose, no explanation — just the rewritten memory value`

/**
 * Rewrite a memory value into imperative form using Claude Haiku.
 * Returns the rewritten string only. Throws if ANTHROPIC_API_KEY not set.
 */
export async function sharpenMemory(
  key: string,
  value: string,
  type: MemoryType,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const userPrompt = `Rewrite this memory entry into imperative form.

Key: ${key}
Type: ${type}
Current value: ${value}

Return only the rewritten value — one sentence starting with ALWAYS, NEVER, MUST, or DO NOT.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!response.ok) {
    throw new Error(`Anthropic API returned ${response.status}`)
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>
  }

  const text = data.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim()

  return text
}
