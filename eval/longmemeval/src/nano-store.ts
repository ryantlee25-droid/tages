/**
 * Embedder bake-off backend: voyage-4-nano (open-weights, Apache-2.0) served
 * LOCALLY by nano_server.py via sentence-transformers, + in-process cosine.
 *
 * Same shape as the OpenAI / Voyage cosine backends, but embeds against a local
 * self-hosted model instead of an API — no rate limits (the reason the Voyage
 * API bake-off failed 50/50 on the free key). Uses the model's asymmetric
 * encode_document / encode_query prompts (document on ingest, query on recall).
 *
 * Requires nano_server.py running on NANO_PORT (default 8399). Start it with the
 * repo venv: `.venv/bin/python nano_server.py`. OPENAI_API_KEY is still required
 * by run.ts for the gpt-4o answer + judge (only the embedding is local).
 */
import type { LongMemEvalQuestion, Turn } from './types.js'
import type { MemoryStore, Backend } from './memory.js'

const PORT = process.env.NANO_PORT || '8399'
const URL = `http://127.0.0.1:${PORT}/embed`
const CHUNK_CHARS = 4000 // same chunking as the nomic/openai/voyage runs, apples-to-apples

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

/** Batch-embeds texts against the local nano server. Batching matters here:
 * the model loads once and encodes a whole session's chunks in one call. */
async function embedBatch(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
  if (texts.length === 0) return []
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, input_type: inputType }),
  })
  if (!res.ok) throw new Error(`nano embed ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { vectors: number[][] }
  return data.vectors
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

export class NanoCosineStore implements MemoryStore {
  backend: Backend = 'nano-cosine'
  private docs: Array<{ text: string; vec: number[] }> = []

  async ingest(q: LongMemEvalQuestion): Promise<void> {
    this.docs = []
    for (let i = 0; i < q.haystack_sessions.length; i++) {
      const text = sessionToText(q.haystack_session_ids[i] ?? `s${i}`, q.haystack_dates[i] ?? '', q.haystack_sessions[i]!)
      const chunks = chunk(text)
      const vecs = await embedBatch(chunks, 'document')
      for (let c = 0; c < chunks.length; c++) this.docs.push({ text: chunks[c]!, vec: vecs[c]! })
    }
  }

  async recall(query: string, topK: number): Promise<string[]> {
    const [qv] = await embedBatch([query], 'query')
    return this.docs
      .map((d) => ({ d, s: cosine(qv!, d.vec) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, topK)
      .map((x) => x.d.text)
  }

  async clear(): Promise<void> {
    this.docs = []
  }
}
