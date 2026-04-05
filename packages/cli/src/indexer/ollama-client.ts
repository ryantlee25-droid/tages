import { buildPrompt } from './extraction-prompt.js'

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3'

export async function analyzeWithOllama(diff: string): Promise<Array<{
  key: string
  value: string
  type: string
  files_affected: string[]
}>> {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: buildPrompt(diff),
      stream: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}`)
  }

  const data = await response.json() as { response: string }
  return parseJsonResponse(data.response)
}

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

function parseJsonResponse(text: string): Array<{
  key: string; value: string; type: string; files_affected: string[]
}> {
  // Try to extract JSON array from response
  const trimmed = text.trim()

  // Direct parse
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed
  } catch { /* continue */ }

  // Try extracting from markdown code block
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (match) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (Array.isArray(parsed)) return parsed
    } catch { /* continue */ }
  }

  // Try finding array brackets
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
