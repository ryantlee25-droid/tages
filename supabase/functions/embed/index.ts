// Tages hosted embedding endpoint.
//
// WHY THIS EXISTS: embedding used to run client-side (CLI + local MCP server),
// which forced every developer to install Ollama or hold an OpenAI key, and —
// worse — let two developers silently write vectors from DIFFERENT models into
// one index. Cosine similarity across models is meaningless, so a mixed index
// returns confident nonsense. Running embedding here makes uniformity
// structural: one endpoint, one model, one vector space, by construction.
//
// PROVIDER: gte-small via the Supabase edge runtime. No API key, no per-call
// cost. 384 dims, zero-padded to 1536 by the caller's existing normalizeTo1536
// so no schema change is needed. Swapping providers later is a change to
// embedOne() alone — but it invalidates every stored vector, so it requires a
// full re-embed. Decide once.

const MODEL = 'gte-small'
const session = new Supabase.ai.Session(MODEL)

interface EmbedRequest { texts?: string[]; text?: string }

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405)
  }

  // Require a real end-user JWT. Without this the endpoint is an open
  // embedding service for anyone who finds the URL.
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'missing bearer token' }, 401)
  }
  const jwt = auth.slice(7).trim()
  const who = await verify(jwt)
  if (!who) return json({ error: 'invalid or expired token' }, 401)

  let body: EmbedRequest
  try { body = await req.json() } catch { return json({ error: 'bad json' }, 400) }

  const texts = body.texts ?? (typeof body.text === 'string' ? [body.text] : null)
  if (!Array.isArray(texts) || texts.length === 0) {
    return json({ error: 'provide `text` (string) or `texts` (string[])' }, 400)
  }
  if (texts.length > 128) return json({ error: 'max 128 texts per call' }, 400)
  if (texts.some(t => typeof t !== 'string')) return json({ error: 'texts must be strings' }, 400)

  const totalChars = texts.reduce((n, t) => n + t.length, 0)
  if (totalChars > 400_000) return json({ error: 'payload too large' }, 413)

  try {
    const embeddings: number[][] = []
    for (const t of texts) {
      // mean_pool + normalize matches what the CLI expects from a provider:
      // a single L2-normalized vector per input.
      const v = await session.run(t, { mean_pool: true, normalize: true })
      embeddings.push(Array.from(v as number[]))
    }
    return json({ model: MODEL, dims: embeddings[0]?.length ?? 0, embeddings })
  } catch (e) {
    return json({ error: `embedding failed: ${e instanceof Error ? e.message : String(e)}` }, 502)
  }
})

async function verify(jwt: string): Promise<string | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon) return null
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${jwt}` },
  })
  if (!r.ok) return null
  const u = await r.json()
  return u?.id ?? null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
