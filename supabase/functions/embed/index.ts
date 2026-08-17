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
//
// AUTHORIZATION: a valid Supabase user JWT is not sufficient — the caller must
// also be a member of the project named by `project_id`. Membership is decided
// by querying `projects` with the CALLER'S OWN JWT so the existing RLS SELECT
// policy (0002_rls_policies.sql:43-45) does the authorization; this function
// only counts rows. No authorization logic is reimplemented here, so it cannot
// drift from the policy. Service-role callers are a trusted bypass (see
// resolveServiceRole).
//
// All three findings below were measured against the live dev project
// (ugogdqzhhnuzwgcaovty) on 2026-08-13, not inferred.

// ---------------------------------------------------------------------------
// FINDING 1 — gte-small SILENTLY TRUNCATES. IT NEVER ERRORS.
// ---------------------------------------------------------------------------
// Measured by embedding progressively longer prefixes of one document and
// comparing the returned vectors. Past the model's context window the vectors
// are BIT-IDENTICAL — proof the trailing bytes are never read.
//
//   32,000 chars -> HTTP 200, 384 dims, no error, no warning, no truncation
//   flag. The vector is identical to the one for the first ~2,350 chars.
//
// This is the dangerous outcome: over-long input degrades retrieval invisibly
// rather than failing loudly. Callers MUST chunk before calling.
//
// The real cap is ~512 TOKENS, so the equivalent character budget moves with
// how densely the text tokenizes. Measured truncation boundaries (the first
// character offset whose content is already being discarded):
//
//   content type            boundary   chars/token
//   English prose             2350       4.59
//   TypeScript source         1472       2.87
//   stack traces              1466       2.86
//   JSON records w/ paths     1107       2.16
//   hex digests / UUIDs        712       1.39
//
// RECOMMENDED CLIENT CHUNK SIZE: 800 chars (CHUNK_TARGET_CHARS_HOSTED in the
// client packages). Derivation: the worst realistic Tages content is
// JSON-shaped memory records at 1107 chars; 800 keeps a 28% margin under that
// and stays under every measured non-opaque boundary. Only pure high-entropy
// strings (hex digests, base64, UUID streams) truncate above 800, and those
// carry no retrievable semantic content, so losing their tail costs nothing.
// chunkText() treats its size argument as a hard ceiling and never overshoots
// (packages/cli/src/lib/chunking.ts), so 800 is a true bound, not a target.
//
// The 4000-char CHUNK_TARGET_CHARS currently in chunking.ts is sized for
// OpenAI's 8192-token window and is ~5x too large for this model.
//
// ---------------------------------------------------------------------------
// FINDING 2 — the isolate's CPU budget, not the payload cap, sets the real
// batch ceiling. 128 texts per call was never achievable.
// ---------------------------------------------------------------------------
// Batches are killed by the edge runtime with HTTP 546 (WORKER_LIMIT) once the
// isolate's CPU budget runs out partway through the loop — each session.run()
// is synchronous CPU work:
//
//   n=4   1.0s  ok     n=12  2.4s  ok
//   n=6   1.4s  ok     n=14  2.6s  ok  <-- hard ceiling
//   n=8   1.7s  ok     n=16  ---   546 (3/3 attempts, deterministic)
//   n=10  2.0s  ok
//
// Cost is dominated by per-call model invocation, not input length: n=8 takes
// ~1.7s whether each text is 1 char or 4000 (past ~512 tokens the extra input
// is discarded anyway, per finding 1). So the ceiling does not move with chunk
// size.
//
// A 546 is not an application error — it carries no `code` for a client to
// branch on, and it tears down the isolate. MAX_TEXTS_PER_CALL is therefore 8
// rather than the measured ceiling of 14, leaving ~35% headroom, and larger
// batches are rejected as an ordinary 400 instead of being left to die as a
// 546.
//
// ---------------------------------------------------------------------------
// FINDING 3 — in-memory rate limiting DOES NOT WORK on this platform.
// ---------------------------------------------------------------------------
// The plan scoped this to a "best-effort per-instance in-memory limiter,"
// accepting that the effective ceiling would be some soft multiple of the
// configured one. Measurement says the discount is far worse than that:
//
//   40 sequential requests were served by 38 DISTINCT ISOLATES.
//   A module-level counter never got past 2.
//
// Every request effectively gets a cold isolate, so per-isolate state is per
// request and the limiter below rejects essentially nothing. Confirmed from
// the outside too: 300 requests driven at 644 req/min against a 120 req/min
// limit produced zero 429s.
//
// The limiter is kept because it is correct, tested, costs nothing, and starts
// working the moment isolates are reused — but it must NOT be described as a
// protection that exists today. Anything that actually needs to bound cost or
// abuse has to be shared state (a Postgres counter table, which needs a
// migration this task does not own). Flagged for follow-up; see
// PLAN-HOSTED-EMBEDDING.md open question 3.
//
// The 429 path itself IS verified live — exercised by temporarily lowering the
// text budget to 1 on dev, which confirmed status 429, code `rate_limited`,
// and a Retry-After header — so the contract clients code against is real.
// ---------------------------------------------------------------------------

const MODEL = 'gte-small'

/** gte-small's output width. A change here silently invalidates every stored
 *  vector, so a mismatch is treated as an upstream failure, not accepted. */
const EXPECTED_DIMS = 384

/** Measured safe batch size (finding 2): the hard ceiling is 14, this leaves
 *  headroom because exceeding it fails as an uncatchable 546 rather than a
 *  normal error. NOT 128 — that value never worked. */
const MAX_TEXTS_PER_CALL = 8

const MAX_TOTAL_CHARS = 400_000

/** Longest input that is safe for ANY content type (finding 1). Exceeding it
 *  is not rejected — the caller may knowingly send prose, which survives to
 *  ~2350 — but it is logged, because it is usually a chunking bug. */
const SILENT_TRUNCATION_FLOOR_CHARS = 712

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Rate limit thresholds. See finding 3: these are aspirational on the current
// runtime, not enforced, because the state they rely on does not survive
// between requests.
//
// The two limits interact: with MAX_TEXTS_PER_CALL at 8, the request cap binds
// first (120 x 8 = 960 texts), so the text budget only matters for callers
// sending many small batches. It is kept as a second ceiling rather than tuned
// to match, so raising the batch size later cannot silently raise the total
// volume one identity can push through.
const RATE_WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 120
const MAX_TEXTS_PER_WINDOW = 2000

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'bad_request'
  | 'payload_too_large'
  | 'rate_limited'
  | 'upstream_error'

export interface ParsedEmbedRequest {
  texts: string[]
  projectId: string
}

export interface EmbedRequestFailure {
  ok: false
  status: number
  error: string
  code: ErrorCode
}

export type ParseEmbedRequestResult =
  | { ok: true; value: ParsedEmbedRequest }
  | EmbedRequestFailure

// ---------------------------------------------------------------------------
// Pure functions — no I/O, no globals. Unit-tested in index.test.ts.
// ---------------------------------------------------------------------------

/**
 * Validate and normalize the request body into `{ texts, projectId }`.
 *
 * `project_id` is required and must be a well-formed UUID. The UUID check is
 * not cosmetic: project_id is interpolated into the PostgREST query string for
 * the membership check, and constraining it to UUID characters removes any
 * possibility of smuggling extra filters into that query.
 *
 * Empty strings are accepted on purpose. The backfill re-embeds every row of a
 * project in one batched call, and rejecting a batch because one memory has an
 * empty value would fail the whole page rather than the one bad row.
 */
export function parseEmbedRequest(raw: unknown): ParseEmbedRequestResult {
  const bad = (error: string): EmbedRequestFailure =>
    ({ ok: false, status: 400, error, code: 'bad_request' })

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return bad('body must be a JSON object')
  }
  const body = raw as Record<string, unknown>

  const projectId = body.project_id
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return bad('`project_id` is required')
  }
  if (!UUID_RE.test(projectId)) {
    return bad('`project_id` must be a UUID')
  }

  // `texts` wins when both are present, matching the original spike's
  // precedence so existing callers do not change behavior.
  let texts: unknown
  if (body.texts !== undefined) {
    texts = body.texts
  } else if (typeof body.text === 'string') {
    texts = [body.text]
  } else {
    return bad('provide `text` (string) or `texts` (string[])')
  }

  if (!Array.isArray(texts) || texts.length === 0) {
    return bad('provide `text` (string) or `texts` (string[])')
  }
  if (texts.length > MAX_TEXTS_PER_CALL) {
    return bad(`max ${MAX_TEXTS_PER_CALL} texts per call`)
  }
  if (!texts.every((t) => typeof t === 'string')) {
    return bad('texts must be strings')
  }

  const strings = texts as string[]
  const totalChars = strings.reduce((n, t) => n + t.length, 0)
  if (totalChars > MAX_TOTAL_CHARS) {
    return {
      ok: false,
      status: 413,
      error: `payload too large: ${totalChars} chars, max ${MAX_TOTAL_CHARS}`,
      code: 'payload_too_large',
    }
  }

  return { ok: true, value: { texts: strings, projectId } }
}

/**
 * Constant-time comparison of a bearer token against one or more service-role
 * credentials.
 *
 * Constant-time matters because a naive `===` on a secret lets an attacker
 * recover it byte by byte from response-timing differences. The early skip on
 * length mismatch does leak the credential's LENGTH, which is not secret. Every
 * candidate is compared even after a match so the work does not depend on the
 * matching key's position in the list.
 */
export function isServiceRoleBearer(
  token: string | null | undefined,
  serviceRoleKeys:
    | string
    | null
    | undefined
    | ReadonlyArray<string | null | undefined>,
): boolean {
  if (!token) return false
  const candidates = Array.isArray(serviceRoleKeys) ? serviceRoleKeys : [serviceRoleKeys]
  const a = new TextEncoder().encode(token)
  let matched = false
  for (const candidate of candidates) {
    if (!candidate) continue
    const b = new TextEncoder().encode(candidate)
    if (a.length !== b.length) continue
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
    if (diff === 0) matched = true
  }
  return matched
}

/**
 * Every service-role credential this deployment recognizes without a network
 * round trip.
 *
 * MEASURED, not assumed: on this project the runtime injects the NEW-format
 * keys, not the legacy JWTs — `SUPABASE_SERVICE_ROLE_KEY` holds an
 * `sb_secret_...` value and `SUPABASE_ANON_KEY` holds an `sb_publishable_...`
 * value. The backfill scripts authenticate with `TAGES_SERVICE_KEY`, which is
 * the LEGACY service_role JWT, so comparing against these env vars alone can
 * never match them — the original design would have locked the backfill out.
 * `SUPABASE_SECRET_KEYS` is JSON (measured shape: {"default":"sb_secret_..."})
 * and is unpacked here so a rotated-in key is picked up without a redeploy.
 * The legacy JWT is handled by verifyServiceRoleToken instead.
 */
export function collectServiceRoleKeys(
  serviceRoleKey: string | null | undefined,
  secretKeysJson: string | null | undefined,
): string[] {
  const out: string[] = []
  if (serviceRoleKey) out.push(serviceRoleKey)
  if (secretKeysJson) {
    try {
      const parsed = JSON.parse(secretKeysJson)
      const values = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object'
        ? Object.values(parsed as Record<string, unknown>)
        : []
      for (const v of values) {
        if (typeof v === 'string' && v) out.push(v)
      }
    } catch {
      // Malformed env is not worth failing a request over; the live
      // verification path below still covers a genuine service-role caller.
    }
  }
  return [...new Set(out)]
}

/** Untrusted JWT payload decode. Used ONLY as a routing hint (see
 *  looksLikeServiceRoleToken) — never as an authorization decision. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const parsed = JSON.parse(atob(padded))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Cheap, UNTRUSTED test for "is this worth verifying as a service-role key?".
 *
 * A forged JWT claiming `role: service_role` passes this and is still rejected
 * by verifyServiceRoleToken, which is the actual check. The only purpose here
 * is to keep ordinary user requests off the verification round trip: without
 * it, every normal call would fire a pointless admin-API request.
 */
export function looksLikeServiceRoleToken(token: string | null | undefined): boolean {
  if (!token) return false
  if (token.startsWith('sb_secret_')) return true
  const payload = decodeJwtPayload(token)
  return payload?.role === 'service_role'
}

export interface RateLimitEvent {
  at: number
  texts: number
}

export interface RateLimitDecision {
  allowed: boolean
  /** Seconds the caller should wait. Always >= 1 when denied, 0 when allowed. */
  retryAfterSeconds: number
}

export interface RateLimits {
  windowMs: number
  maxRequests: number
  maxTexts: number
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  windowMs: RATE_WINDOW_MS,
  maxRequests: MAX_REQUESTS_PER_WINDOW,
  maxTexts: MAX_TEXTS_PER_WINDOW,
}

/**
 * Sliding-window rate limit for one identity, over caller-supplied state.
 *
 * State is passed in rather than closed over so this stays pure and testable:
 * the caller owns the Map, the clock is a parameter. On allow, the request is
 * recorded; on deny, nothing is recorded, so a throttled caller hammering the
 * endpoint cannot push its own reset time further out.
 *
 * See finding 3 for why the state this operates on does not currently survive
 * between requests. The function is correct; its input is the problem.
 */
export function checkRateLimit(
  state: Map<string, RateLimitEvent[]>,
  identity: string,
  textCount: number,
  now: number,
  limits: RateLimits = DEFAULT_RATE_LIMITS,
): RateLimitDecision {
  const cutoff = now - limits.windowMs
  const events = (state.get(identity) ?? []).filter((e) => e.at > cutoff)

  const retryAfter = () => {
    const oldest = events[0]
    if (!oldest) return 1
    return Math.max(1, Math.ceil((oldest.at + limits.windowMs - now) / 1000))
  }

  if (events.length >= limits.maxRequests) {
    state.set(identity, events)
    return { allowed: false, retryAfterSeconds: retryAfter() }
  }

  const usedTexts = events.reduce((n, e) => n + e.texts, 0)
  if (usedTexts + textCount > limits.maxTexts) {
    state.set(identity, events)
    return { allowed: false, retryAfterSeconds: retryAfter() }
  }

  events.push({ at: now, texts: textCount })
  state.set(identity, events)
  return { allowed: true, retryAfterSeconds: 0 }
}

/** Drop identities with no events left in the window, so a long-lived isolate
 *  does not accumulate a Map entry per user seen since cold start. */
export function pruneRateLimitState(
  state: Map<string, RateLimitEvent[]>,
  now: number,
  limits: RateLimits = DEFAULT_RATE_LIMITS,
): void {
  const cutoff = now - limits.windowMs
  for (const [identity, events] of state) {
    const live = events.filter((e) => e.at > cutoff)
    if (live.length === 0) state.delete(identity)
    else state.set(identity, live)
  }
}

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export function errorResponse(
  error: string,
  code: ErrorCode,
  status: number,
  headers: HeadersInit = {},
): Response {
  return jsonResponse({ error, code }, status, headers)
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

interface AiSession {
  run(input: string, opts: { mean_pool: boolean; normalize: boolean }): Promise<unknown>
}

let cachedSession: AiSession | null = null

/** Lazily constructed so this module can be imported by `deno test`, where the
 *  `Supabase` global does not exist. Cold-start cost is unchanged: the model
 *  loads on first request instead of first import, and the first request is
 *  what triggers the cold start anyway. */
function getSession(): AiSession {
  if (!cachedSession) {
    const g = globalThis as unknown as {
      Supabase?: { ai: { Session: new (model: string) => AiSession } }
    }
    if (!g.Supabase?.ai?.Session) throw new Error('Supabase.ai runtime unavailable')
    cachedSession = new g.Supabase.ai.Session(MODEL)
  }
  return cachedSession
}

/** Resolve a user JWT to an auth.users id, or null if it is not a valid user
 *  session. A service-role JWT has no auth.users row and returns null here —
 *  which is why the service-role bypass has to run before this. */
async function verifyUser(jwt: string): Promise<string | null> {
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

const verifiedServiceTokens = new Map<string, number>()
const SERVICE_TOKEN_CACHE_MS = 5 * 60_000

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Confirm a token really carries service-role privilege by asking GoTrue.
 *
 * The admin user-list endpoint is service-role-only, which makes it a clean
 * oracle — verified on dev: legacy service_role key -> 200, ordinary user JWT
 * -> 401, anon key -> 403, garbage -> 401. This is what lets the legacy
 * service_role JWT (what the backfill scripts actually send) be trusted
 * without the edge runtime ever exposing its value, and without trusting the
 * token's own unsigned `role` claim.
 *
 * Only reached for tokens that already look like service-role credentials.
 * Memoized by digest, though per finding 3 the cache rarely survives to a
 * second request; the cost is one extra round trip on the backfill path only.
 * Only positives are cached: caching a negative would pin a stale denial if a
 * key were rotated in.
 */
async function verifyServiceRoleToken(token: string): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL')
  if (!url) return false

  const digest = await sha256Hex(token)
  const cachedAt = verifiedServiceTokens.get(digest)
  const now = Date.now()
  if (cachedAt !== undefined && now - cachedAt < SERVICE_TOKEN_CACHE_MS) return true

  try {
    const r = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { apikey: token, Authorization: `Bearer ${token}` },
    })
    // Drain the body so the connection is not left half-read.
    await r.arrayBuffer()
    if (!r.ok) return false
  } catch {
    return false
  }

  for (const [k, at] of verifiedServiceTokens) {
    if (now - at >= SERVICE_TOKEN_CACHE_MS) verifiedServiceTokens.delete(k)
  }
  verifiedServiceTokens.set(digest, now)
  return true
}

/** True when the caller holds service-role privilege, by fast constant-time
 *  match first and live verification only as a fallback. */
async function resolveServiceRole(jwt: string): Promise<boolean> {
  const keys = collectServiceRoleKeys(
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    Deno.env.get('SUPABASE_SECRET_KEYS'),
  )
  if (isServiceRoleBearer(jwt, keys)) return true
  if (!looksLikeServiceRoleToken(jwt)) return false
  return await verifyServiceRoleToken(jwt)
}

/**
 * Is the caller allowed to see this project? Decided entirely by RLS: the query
 * runs as the caller, and the SELECT policy on `projects` already resolves
 * `owner_id = auth.uid() or is_project_member(auth.uid(), id)`.
 *
 * Returns null (not false) when the check itself could not be completed, so a
 * PostgREST outage surfaces as 502 rather than being reported to the caller as
 * "you are not a member" — a denial we could not actually substantiate.
 */
async function isProjectMember(jwt: string, projectId: string): Promise<boolean | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon) return null
  const target = `${url}/rest/v1/projects?select=id&id=eq.${projectId}&limit=1`
  const r = await fetch(target, {
    headers: { apikey: anon, Authorization: `Bearer ${jwt}` },
  })
  if (!r.ok) return null
  const rows = await r.json()
  if (!Array.isArray(rows)) return null
  return rows.length > 0
}

const rateLimitState = new Map<string, RateLimitEvent[]>()

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return errorResponse('POST only', 'bad_request', 405)
  }

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return errorResponse('missing bearer token', 'unauthorized', 401)
  }
  const jwt = auth.slice(7).trim()
  if (!jwt) {
    return errorResponse('missing bearer token', 'unauthorized', 401)
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return errorResponse('bad json', 'bad_request', 400)
  }

  const parsed = parseEmbedRequest(raw)
  if (!parsed.ok) {
    return errorResponse(parsed.error, parsed.code, parsed.status)
  }
  const { texts, projectId } = parsed.value

  // Trusted bypass. The service-role key already bypasses RLS everywhere else
  // in this repo, so a holder of it can read every project directly — gating
  // this endpoint against it would protect nothing while breaking the backfill
  // scripts, which cannot authenticate any other way (they have no user
  // session). Rate limiting is skipped for the same reason: throttling a
  // first-party batch job adds no security, only self-inflicted 429s.
  const isServiceRole = await resolveServiceRole(jwt)

  if (!isServiceRole) {
    const userId = await verifyUser(jwt)
    if (!userId) {
      return errorResponse('invalid or expired token', 'unauthorized', 401)
    }

    const member = await isProjectMember(jwt, projectId)
    if (member === null) {
      return errorResponse('could not verify project membership', 'upstream_error', 502)
    }
    // Deliberately identical to the not-a-project response: distinguishing
    // "forbidden" from "does not exist" would let any signed-up user probe
    // which project ids are real.
    if (!member) {
      return errorResponse('project not found or access denied', 'forbidden', 403)
    }

    const now = Date.now()
    const decision = checkRateLimit(rateLimitState, userId, texts.length, now)
    if (!decision.allowed) {
      return errorResponse('rate limit exceeded', 'rate_limited', 429, {
        'Retry-After': String(decision.retryAfterSeconds),
      })
    }
    pruneRateLimitState(rateLimitState, now)
  }

  const longest = texts.reduce((n, t) => Math.max(n, t.length), 0)
  if (longest > SILENT_TRUNCATION_FLOOR_CHARS) {
    // Length only — never the text, which may contain memory values.
    console.warn(
      `embed: text of ${longest} chars exceeds the ${SILENT_TRUNCATION_FLOOR_CHARS}-char ` +
        `always-safe bound for ${MODEL}; content past ~512 tokens is silently discarded`,
    )
  }

  try {
    const session = getSession()
    const embeddings: number[][] = []
    for (const t of texts) {
      // mean_pool + normalize matches what the CLI expects from a provider:
      // a single L2-normalized vector per input.
      const v = await session.run(t, { mean_pool: true, normalize: true })
      embeddings.push(Array.from(v as number[]))
    }

    const dims = embeddings[0]?.length ?? 0
    if (dims !== EXPECTED_DIMS) {
      // A dimension change means the provider changed underneath us, which
      // silently corrupts the shared vector space. Fail loudly instead of
      // writing vectors that are incomparable with every stored one.
      return errorResponse(
        `unexpected embedding width: got ${dims}, expected ${EXPECTED_DIMS}`,
        'upstream_error',
        502,
      )
    }

    return jsonResponse({ model: MODEL, dims, embeddings })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return errorResponse(`embedding failed: ${detail}`, 'upstream_error', 502)
  }
}

// Guarded so `deno test` can import the pure functions without binding a port.
// The variable is never set in the deployed environment.
if (!Deno.env.get('TAGES_EMBED_DISABLE_SERVE')) {
  Deno.serve(handleRequest)
}
