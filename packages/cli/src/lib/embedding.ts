/**
 * CLI-local embedding generation for semantic recall.
 *
 * Mirrors packages/server/src/embeddings.ts's Ollama -> OpenAI fallback chain
 * and 1536-dim normalization. Deliberately NOT imported from @tages/server:
 * a runtime dependency on the server package would break `npm install -g
 * @tages/cli` standalone installs. Keep this file in sync with the server's
 * copy by hand if either fallback order or normalization logic changes.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'

export async function generateEmbedding(text: string): Promise<number[] | null> {
  // Try Ollama first (local, fast)
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) {
      const data = await res.json() as { embedding: number[] }
      if (data.embedding?.length > 0) return normalizeTo1536(data.embedding)
    }
  } catch {
    // Ollama not available
  }

  // Fall back to OpenAI-compatible API
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json() as { data: Array<{ embedding: number[] }> }
        if (data.data?.[0]?.embedding) return normalizeTo1536(data.data[0].embedding)
      }
    } catch {
      // OpenAI not available
    }
  }

  return null
}

function normalizeTo1536(embedding: number[]): number[] {
  if (embedding.length === 1536) return embedding
  if (embedding.length > 1536) {
    const truncated = embedding.slice(0, 1536)
    const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0))
    if (norm === 0) return truncated
    return truncated.map((v) => v / norm)
  }
  return [...embedding, ...new Array(1536 - embedding.length).fill(0)]
}
