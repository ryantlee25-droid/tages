import { buildPrompt } from './extraction-prompt.js'

export async function analyzeWithHaiku(diff: string): Promise<Array<{
  key: string
  value: string
  type: string
  files_affected: string[]
}>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: buildPrompt(diff),
      }],
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

  return parseJsonResponse(text)
}

function parseJsonResponse(text: string): Array<{
  key: string; value: string; type: string; files_affected: string[]
}> {
  const trimmed = text.trim()

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed
  } catch { /* continue */ }

  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (match) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (Array.isArray(parsed)) return parsed
    } catch { /* continue */ }
  }

  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch { /* continue */ }
  }

  return []
}
