/**
 * Self-embedding semantic backend for the eval.
 *
 * The Tages product write path never generates document embeddings
 * (upsertMemoryWithEmbedding has no callers), so the pgvector column is always
 * empty and CLI/MCP recall is trigram-only. To measure what the *semantic* path
 * would deliver, this backend does the encode itself:
 *
 *   - ingest: embed each session with Ollama (nomic-embed-text, free/local),
 *     pad 768 -> 1536, INSERT directly into dev's `memories` with the vector.
 *   - recall: embed the query, call the `semantic_recall` RPC (pgvector) on dev.
 *   - clear: delete the eval project's memories.
 *
 * Requires env: TAGES_SUPABASE_URL, TAGES_SERVICE_KEY, TAGES_EVAL_PROJECT (slug).
 */
import type { LongMemEvalQuestion, Turn } from './types.js'
import type { MemoryStore, Backend } from './memory.js'

const OLLAMA = 'http://localhost:11434/api/embeddings'
const EMBED_MODEL = 'nomic-embed-text'
const DIM = 1536

function sessionToText(sessionId: string, date: string, turns: Turn[]): string {
  const body = turns.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join('\n\n')
  return `[session=${sessionId} date=${date}]\n${body}`
}

// nomic-embed-text has a ~2048-token context. Keep chunks well under that
// (~4000 chars ~= ~1000 tokens) so long session transcripts don't 500.
const CHUNK_CHARS = 4000

/** Split text into <=CHUNK_CHARS pieces, preferring turn/paragraph boundaries. */
function chunk(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text]
  const parts: string[] = []
  const paras = text.split('\n\n')
  let buf = ''
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > CHUNK_CHARS) {
      parts.push(buf)
      buf = ''
    }
    if (p.length > CHUNK_CHARS) {
      // A single oversized turn: hard-split it.
      for (let i = 0; i < p.length; i += CHUNK_CHARS) parts.push(p.slice(i, i + CHUNK_CHARS))
    } else {
      buf = buf ? `${buf}\n\n${p}` : p
    }
  }
  if (buf) parts.push(buf)
  return parts
}

async function embed(text: string): Promise<string> {
  // Safety cap: never send more than one chunk's worth to the model.
  const input = text.length > CHUNK_CHARS ? text.slice(0, CHUNK_CHARS) : text
  const res = await fetch(OLLAMA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: input }),
  })
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`)
  const data = (await res.json()) as { embedding: number[] }
  let v = data.embedding
  if (v.length < DIM) v = [...v, ...new Array(DIM - v.length).fill(0)]
  else if (v.length > DIM) v = v.slice(0, DIM)
  return `[${v.join(',')}]`
}

export class SemanticDevStore implements MemoryStore {
  backend: Backend = 'tages-cli'
  private base: string
  private key: string
  private slug: string
  private projectId: string | null = null
  private insertErrLogged = false

  constructor() {
    this.base = (process.env.TAGES_SUPABASE_URL || '').replace(/\/$/, '')
    this.key = process.env.TAGES_SERVICE_KEY || ''
    this.slug = process.env.TAGES_EVAL_PROJECT || ''
    if (!this.base || !this.key || !this.slug) {
      throw new Error('SemanticDevStore needs TAGES_SUPABASE_URL, TAGES_SERVICE_KEY, TAGES_EVAL_PROJECT')
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      ...extra,
    }
  }

  private async pid(): Promise<string> {
    if (this.projectId) return this.projectId
    const res = await fetch(`${this.base}/rest/v1/projects?slug=eq.${this.slug}&select=id`, {
      headers: this.headers(),
    })
    const rows = (await res.json()) as Array<{ id: string }>
    if (!rows.length) throw new Error(`eval project slug not found in dev: ${this.slug}`)
    this.projectId = rows[0]!.id
    return this.projectId
  }

  async ingest(q: LongMemEvalQuestion): Promise<void> {
    await this.clear()
    const pid = await this.pid()
    for (let i = 0; i < q.haystack_sessions.length; i++) {
      const text = sessionToText(
        q.haystack_session_ids[i] ?? `s${i}`,
        q.haystack_dates[i] ?? '',
        q.haystack_sessions[i]!,
      )
      const chunks = chunk(text)
      for (let j = 0; j < chunks.length; j++) {
        const embedding = await embed(chunks[j]!)
        const res = await fetch(`${this.base}/rest/v1/memories`, {
          method: 'POST',
          headers: this.headers({ Prefer: 'return=minimal' }),
          body: JSON.stringify({
            project_id: pid,
            key: `longmemeval-${q.question_id}-s${i}-c${j}`,
            value: chunks[j],
            type: 'entity',
            embedding,
          }),
        })
        if (!res.ok && !this.insertErrLogged) {
          this.insertErrLogged = true
          console.error(`[semantic-store] insert failed ${res.status}: ${(await res.text()).slice(0, 300)}`)
        }
      }
    }
  }

  async recall(query: string, topK: number): Promise<string[]> {
    const pid = await this.pid()
    const embedding = await embed(query)
    const res = await fetch(`${this.base}/rest/v1/rpc/semantic_recall`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        p_project_id: pid,
        p_embedding: embedding,
        p_type: null,
        p_limit: topK,
        p_threshold: 0.3,
      }),
    })
    if (!res.ok) {
      console.error(`[semantic-store] semantic_recall failed ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return []
    }
    const rows = (await res.json()) as Array<{ value?: string }>
    return rows.map((r) => r.value ?? '').filter(Boolean)
  }

  async clear(): Promise<void> {
    const pid = await this.pid()
    await fetch(`${this.base}/rest/v1/memories?project_id=eq.${pid}`, {
      method: 'DELETE',
      headers: this.headers({ Prefer: 'return=minimal' }),
    })
  }
}
