/**
 * Embedder bake-off backend: Voyage voyage-code-3 + in-process cosine.
 *
 * Same shape as the OpenAI cosine backend, but uses Voyage's code-tuned model
 * and its asymmetric input_type (document on ingest, query on recall), which
 * improves retrieval. Default output dim is 1024.
 *
 * Requires VOYAGE_API_KEY.
 */
import type { LongMemEvalQuestion, Turn } from './types.js'
import type { MemoryStore, Backend } from './memory.js'

const MODEL = process.env.VOYAGE_MODEL || 'voyage-code-3'
const CHUNK_CHARS = 4000

function sessionToText(sessionId: string, date: string, turns: Turn[]): string {
  const body = turns.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join('\n\n')
  return `[session=${sessionId} date=${date}]\n${body}`
}

function chunk(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text]
  const parts: string[] = []
  let buf = ''
  for (const p of text.split('\n\n')) {
    if (buf && buf.length + p.length + 2 > CHUNK_CHARS) { parts.push(buf); buf = '' }
    if (p.length > CHUNK_CHARS) {
      for (let i = 0; i < p.length; i += CHUNK_CHARS) parts.push(p.slice(i, i + CHUNK_CHARS))
    } else {
      buf = buf ? `${buf}\n\n${p}` : p
    }
  }
  if (buf) parts.push(buf)
  return parts
}

async function embed(text: string, inputType: 'document' | 'query'): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ model: MODEL, input: [text], input_type: inputType }),
  })
  if (!res.ok) throw new Error(`Voyage embed ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> }
  return data.data[0]!.embedding
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

export class VoyageCosineStore implements MemoryStore {
  backend: Backend = 'voyage-cosine'
  private docs: Array<{ text: string; vec: number[] }> = []

  async ingest(q: LongMemEvalQuestion): Promise<void> {
    this.docs = []
    for (let i = 0; i < q.haystack_sessions.length; i++) {
      const text = sessionToText(q.haystack_session_ids[i] ?? `s${i}`, q.haystack_dates[i] ?? '', q.haystack_sessions[i]!)
      for (const c of chunk(text)) {
        this.docs.push({ text: c, vec: await embed(c, 'document') })
      }
    }
  }

  async recall(query: string, topK: number): Promise<string[]> {
    const qv = await embed(query, 'query')
    return this.docs
      .map((d) => ({ d, s: cosine(qv, d.vec) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, topK)
      .map((x) => x.d.text)
  }

  async clear(): Promise<void> {
    this.docs = []
  }
}
