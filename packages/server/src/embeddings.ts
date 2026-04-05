/**
 * Embedding generation for semantic search.
 * Tries providers in order: local Ollama → Anthropic API → skip.
 *
 * Uses 1536-dimension embeddings (OpenAI-compatible) for pgvector.
 * Ollama uses nomic-embed-text; Anthropic doesn't have embeddings,
 * so we fall back to OpenAI-compatible API if OPENAI_API_KEY is set.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'

export async function generateEmbedding(text: string): Promise<number[] | null> {
  // Try Ollama first
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: text,
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (res.ok) {
      const data = await res.json() as { embedding: number[] }
      if (data.embedding?.length > 0) {
        // Pad or truncate to 1536 dims
        return normalizeTo1536(data.embedding)
      }
    }
  } catch {
    // Ollama not available
  }

  // Try OpenAI-compatible API
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text,
        }),
        signal: AbortSignal.timeout(10000),
      })

      if (res.ok) {
        const data = await res.json() as { data: Array<{ embedding: number[] }> }
        if (data.data?.[0]?.embedding) {
          return normalizeTo1536(data.data[0].embedding)
        }
      }
    } catch {
      // OpenAI not available
    }
  }

  return null
}

function normalizeTo1536(embedding: number[]): number[] {
  if (embedding.length === 1536) return embedding
  if (embedding.length > 1536) return embedding.slice(0, 1536)
  // Pad with zeros
  return [...embedding, ...new Array(1536 - embedding.length).fill(0)]
}
