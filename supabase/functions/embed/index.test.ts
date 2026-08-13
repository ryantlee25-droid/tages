// Unit tests for the pure parts of the hosted embedding endpoint.
//
// Run:  deno test --allow-env supabase/functions/embed/index.test.ts
//
// Deliberately dependency-free: pulling in std/assert over the network would
// make the suite need --allow-net and would drop a deno.lock at the repo root,
// which nothing else in this pnpm monorepo owns. The three helpers below are
// all these tests need.
//
// TAGES_EMBED_DISABLE_SERVE must be set BEFORE index.ts is imported, otherwise
// importing it binds a port. That is why the import is dynamic rather than a
// top-level `import ... from './index.ts'`.

function assert(cond: unknown, msg = 'assertion failed'): asserts cond {
  if (!cond) throw new Error(msg)
}

function assertFalse(cond: unknown, msg = 'expected falsy'): void {
  if (cond) throw new Error(msg)
}

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(msg ?? `expected ${b}, got ${a}`)
}

Deno.env.set('TAGES_EMBED_DISABLE_SERVE', '1')

const {
  parseEmbedRequest,
  isServiceRoleBearer,
  collectServiceRoleKeys,
  decodeJwtPayload,
  looksLikeServiceRoleToken,
  checkRateLimit,
  pruneRateLimitState,
  errorResponse,
  jsonResponse,
  DEFAULT_RATE_LIMITS,
} = await import('./index.ts')

/** Measured ceiling, mirrored from index.ts (finding 2). Hard-coded rather
 *  than imported so a silent change to the constant fails a test. */
const MAX_TEXTS_PER_CALL = 8

type RateLimitEvent = { at: number; texts: number }

const PROJECT = '87dfd829-d64e-4e88-aa63-4aed4cc7a33e'

// ---------------------------------------------------------------------------
// parseEmbedRequest
// ---------------------------------------------------------------------------

Deno.test('parseEmbedRequest: accepts single `text` with project_id', () => {
  const r = parseEmbedRequest({ text: 'hello', project_id: PROJECT })
  assert(r.ok)
  assertEquals(r.value.texts, ['hello'])
  assertEquals(r.value.projectId, PROJECT)
})

Deno.test('parseEmbedRequest: accepts `texts` array', () => {
  const r = parseEmbedRequest({ texts: ['a', 'b'], project_id: PROJECT })
  assert(r.ok)
  assertEquals(r.value.texts, ['a', 'b'])
})

Deno.test('parseEmbedRequest: `texts` takes precedence over `text`', () => {
  const r = parseEmbedRequest({ text: 'ignored', texts: ['kept'], project_id: PROJECT })
  assert(r.ok)
  assertEquals(r.value.texts, ['kept'])
})

Deno.test('parseEmbedRequest: project_id is required', () => {
  const r = parseEmbedRequest({ text: 'hello' })
  assertFalse(r.ok)
  if (r.ok) return
  assertEquals(r.code, 'bad_request')
  assertEquals(r.status, 400)
  assert(r.error.includes('project_id'))
})

Deno.test('parseEmbedRequest: project_id must be a UUID', () => {
  // Guards the PostgREST query string the membership check interpolates into.
  for (const pid of ['not-a-uuid', '', '1', `${PROJECT}&owner_id=eq.x`, `${PROJECT} or true`]) {
    const r = parseEmbedRequest({ text: 'hello', project_id: pid })
    assertFalse(r.ok, `expected rejection for ${JSON.stringify(pid)}`)
    if (!r.ok) assertEquals(r.code, 'bad_request')
  }
})

Deno.test('parseEmbedRequest: accepts an uppercase UUID', () => {
  const r = parseEmbedRequest({ text: 'hello', project_id: PROJECT.toUpperCase() })
  assert(r.ok)
})

Deno.test('parseEmbedRequest: rejects non-object bodies', () => {
  for (const body of [null, 'string', 42, ['a'], undefined]) {
    const r = parseEmbedRequest(body)
    assertFalse(r.ok, `expected rejection for ${JSON.stringify(body)}`)
    if (!r.ok) assertEquals(r.code, 'bad_request')
  }
})

Deno.test('parseEmbedRequest: rejects a missing/empty text payload', () => {
  for (const body of [
    { project_id: PROJECT },
    { project_id: PROJECT, texts: [] },
    { project_id: PROJECT, text: 42 },
    { project_id: PROJECT, texts: 'not-an-array' },
  ]) {
    const r = parseEmbedRequest(body)
    assertFalse(r.ok, `expected rejection for ${JSON.stringify(body)}`)
    if (!r.ok) assertEquals(r.code, 'bad_request')
  }
})

Deno.test('parseEmbedRequest: rejects non-string entries in texts', () => {
  const r = parseEmbedRequest({ texts: ['ok', 7], project_id: PROJECT })
  assertFalse(r.ok)
  if (!r.ok) assertEquals(r.code, 'bad_request')
})

Deno.test('parseEmbedRequest: caps the batch at the measured 546 ceiling', () => {
  // Larger batches are killed by the edge runtime as an uncatchable HTTP 546
  // with no error code, so the cap has to reject them as a normal 400 first.
  const ok = parseEmbedRequest({ texts: Array(MAX_TEXTS_PER_CALL).fill('x'), project_id: PROJECT })
  assert(ok.ok)

  const tooMany = parseEmbedRequest({
    texts: Array(MAX_TEXTS_PER_CALL + 1).fill('x'),
    project_id: PROJECT,
  })
  assertFalse(tooMany.ok)
  if (!tooMany.ok) assertEquals(tooMany.code, 'bad_request')

  // The spike's advertised 128 must NOT be accepted — it never worked.
  const legacyCap = parseEmbedRequest({ texts: Array(128).fill('x'), project_id: PROJECT })
  assertFalse(legacyCap.ok)
})

Deno.test('parseEmbedRequest: oversized payload is 413 payload_too_large', () => {
  const r = parseEmbedRequest({ texts: [`${'x'.repeat(400_001)}`], project_id: PROJECT })
  assertFalse(r.ok)
  if (r.ok) return
  assertEquals(r.status, 413)
  assertEquals(r.code, 'payload_too_large')
})

Deno.test('parseEmbedRequest: payload cap counts the whole batch, not one text', () => {
  // 8 x 50,001 = 400,008 chars: no single text trips the cap, the batch does.
  const r = parseEmbedRequest({
    texts: Array(MAX_TEXTS_PER_CALL).fill('x'.repeat(50_001)),
    project_id: PROJECT,
  })
  assertFalse(r.ok)
  if (!r.ok) assertEquals(r.code, 'payload_too_large')
})

Deno.test('parseEmbedRequest: empty strings are accepted on purpose', () => {
  // A backfill page must not fail wholesale because one memory value is empty.
  const r = parseEmbedRequest({ texts: ['', 'real'], project_id: PROJECT })
  assert(r.ok)
  assertEquals(r.value.texts, ['', 'real'])
})

// ---------------------------------------------------------------------------
// isServiceRoleBearer
// ---------------------------------------------------------------------------

Deno.test('isServiceRoleBearer: matches the exact key', () => {
  assert(isServiceRoleBearer('sk-service-role-abc', 'sk-service-role-abc'))
})

Deno.test('isServiceRoleBearer: rejects near-misses', () => {
  assertFalse(isServiceRoleBearer('sk-service-role-abd', 'sk-service-role-abc'))
  assertFalse(isServiceRoleBearer('sk-service-role-ab', 'sk-service-role-abc'))
  assertFalse(isServiceRoleBearer('sk-service-role-abcd', 'sk-service-role-abc'))
  assertFalse(isServiceRoleBearer('SK-SERVICE-ROLE-ABC', 'sk-service-role-abc'))
})

Deno.test('isServiceRoleBearer: never matches when either side is absent', () => {
  // The dangerous case: an unset env var must not turn every empty/garbage
  // bearer token into a trusted service-role caller.
  assertFalse(isServiceRoleBearer('anything', undefined))
  assertFalse(isServiceRoleBearer('anything', null))
  assertFalse(isServiceRoleBearer('anything', ''))
  assertFalse(isServiceRoleBearer('', ''))
  assertFalse(isServiceRoleBearer('', 'sk-service-role-abc'))
  assertFalse(isServiceRoleBearer(null, 'sk-service-role-abc'))
  assertFalse(isServiceRoleBearer(undefined, undefined))
})

Deno.test('isServiceRoleBearer: compares bytes, not code units', () => {
  assert(isServiceRoleBearer('kéy-ünïcode', 'kéy-ünïcode'))
  assertFalse(isServiceRoleBearer('key-unicode', 'kéy-ünïcode'))
})

Deno.test('isServiceRoleBearer: accepts a list of candidate keys', () => {
  assert(isServiceRoleBearer('sb_secret_two', ['sb_secret_one', 'sb_secret_two']))
  assertFalse(isServiceRoleBearer('sb_secret_three', ['sb_secret_one', 'sb_secret_two']))
})

Deno.test('isServiceRoleBearer: tolerates holes in the candidate list', () => {
  assert(isServiceRoleBearer('sb_secret_one', [null, undefined, '', 'sb_secret_one']))
  assertFalse(isServiceRoleBearer('sb_secret_one', [null, undefined, '']))
  assertFalse(isServiceRoleBearer('sb_secret_one', []))
})

// ---------------------------------------------------------------------------
// collectServiceRoleKeys
// ---------------------------------------------------------------------------

Deno.test('collectServiceRoleKeys: unpacks the SUPABASE_SECRET_KEYS JSON object', () => {
  // Measured shape on dev: {"default":"sb_secret_..."}
  const keys = collectServiceRoleKeys('sb_secret_primary', '{"default":"sb_secret_other"}')
  assertEquals(keys, ['sb_secret_primary', 'sb_secret_other'])
})

Deno.test('collectServiceRoleKeys: accepts a JSON array too', () => {
  assertEquals(
    collectServiceRoleKeys(null, '["sb_secret_a","sb_secret_b"]'),
    ['sb_secret_a', 'sb_secret_b'],
  )
})

Deno.test('collectServiceRoleKeys: de-duplicates', () => {
  assertEquals(collectServiceRoleKeys('sb_secret_a', '{"default":"sb_secret_a"}'), ['sb_secret_a'])
})

Deno.test('collectServiceRoleKeys: malformed or empty env yields no keys', () => {
  // Must not throw: a broken env var would otherwise 500 every request.
  assertEquals(collectServiceRoleKeys(null, 'not json'), [])
  assertEquals(collectServiceRoleKeys(undefined, undefined), [])
  assertEquals(collectServiceRoleKeys('', ''), [])
  assertEquals(collectServiceRoleKeys(null, '{"a":1,"b":null}'), [])
  assertEquals(collectServiceRoleKeys(null, '"a string"'), [])
})

// ---------------------------------------------------------------------------
// decodeJwtPayload / looksLikeServiceRoleToken
// ---------------------------------------------------------------------------

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2ln`
}

Deno.test('decodeJwtPayload: reads a base64url payload', () => {
  assertEquals(decodeJwtPayload(jwt({ role: 'service_role', iss: 'supabase' })), {
    role: 'service_role',
    iss: 'supabase',
  })
})

Deno.test('decodeJwtPayload: returns null for anything that is not a JWT', () => {
  for (const t of ['', 'not-a-jwt', 'a.b', 'a.b.c.d', 'a.!!!.c', jwt([] as unknown as Record<string, unknown>)]) {
    assertEquals(decodeJwtPayload(t), null, `expected null for ${JSON.stringify(t)}`)
  }
})

Deno.test('looksLikeServiceRoleToken: recognizes both credential formats', () => {
  assert(looksLikeServiceRoleToken('sb_secret_abc123'))
  assert(looksLikeServiceRoleToken(jwt({ role: 'service_role' })))
})

Deno.test('looksLikeServiceRoleToken: ignores ordinary user and anon tokens', () => {
  // Keeps normal traffic off the verification round trip.
  assertFalse(looksLikeServiceRoleToken(jwt({ role: 'authenticated', sub: 'u1' })))
  assertFalse(looksLikeServiceRoleToken(jwt({ role: 'anon' })))
  assertFalse(looksLikeServiceRoleToken('sb_publishable_abc123'))
  assertFalse(looksLikeServiceRoleToken('garbage'))
  assertFalse(looksLikeServiceRoleToken(''))
  assertFalse(looksLikeServiceRoleToken(null))
})

Deno.test('looksLikeServiceRoleToken: is a routing hint, NOT authorization', () => {
  // A forged, unsigned token claiming service_role passes this on purpose —
  // it is then rejected by the live verification the hint routes it to. This
  // test exists so nobody promotes the hint into a trust decision.
  assert(looksLikeServiceRoleToken(jwt({ role: 'service_role', forged: true })))
})

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------

function state() {
  return new Map<string, RateLimitEvent[]>()
}

const LIMITS = { windowMs: 60_000, maxRequests: 3, maxTexts: 10 }

Deno.test('checkRateLimit: allows up to the request cap, then denies', () => {
  const s = state()
  for (let i = 0; i < 3; i++) {
    assert(checkRateLimit(s, 'user-a', 1, 1000, LIMITS).allowed, `call ${i} should pass`)
  }
  const denied = checkRateLimit(s, 'user-a', 1, 1000, LIMITS)
  assertFalse(denied.allowed)
  assertEquals(denied.retryAfterSeconds, 60)
})

Deno.test('checkRateLimit: denies on the text budget before the request cap', () => {
  const s = state()
  assert(checkRateLimit(s, 'user-a', 9, 1000, LIMITS).allowed)
  const denied = checkRateLimit(s, 'user-a', 2, 1000, LIMITS)
  assertFalse(denied.allowed)
  // Still only one request recorded, so the request cap was not the trigger.
  assert(checkRateLimit(s, 'user-a', 1, 1000, LIMITS).allowed)
})

Deno.test('checkRateLimit: a denied call is not recorded', () => {
  // Otherwise a client retrying in a tight loop would keep pushing its own
  // reset time out and never recover.
  const s = state()
  for (let i = 0; i < 3; i++) checkRateLimit(s, 'user-a', 1, 1000, LIMITS)
  for (let i = 0; i < 50; i++) checkRateLimit(s, 'user-a', 1, 1000, LIMITS)
  assertEquals(s.get('user-a')!.length, 3)
  // Once the original three age out, the caller is clear again.
  assert(checkRateLimit(s, 'user-a', 1, 61_001, LIMITS).allowed)
})

Deno.test('checkRateLimit: the window slides rather than resetting on a boundary', () => {
  const s = state()
  checkRateLimit(s, 'user-a', 1, 1000, LIMITS)
  checkRateLimit(s, 'user-a', 1, 30_000, LIMITS)
  checkRateLimit(s, 'user-a', 1, 50_000, LIMITS)
  assertFalse(checkRateLimit(s, 'user-a', 1, 55_000, LIMITS).allowed)

  // At t=61,001 only the first event has expired: one slot frees up, one only.
  assert(checkRateLimit(s, 'user-a', 1, 61_001, LIMITS).allowed)
  assertFalse(checkRateLimit(s, 'user-a', 1, 61_002, LIMITS).allowed)
})

Deno.test('checkRateLimit: identities are isolated', () => {
  const s = state()
  for (let i = 0; i < 3; i++) checkRateLimit(s, 'user-a', 1, 1000, LIMITS)
  assertFalse(checkRateLimit(s, 'user-a', 1, 1000, LIMITS).allowed)
  assert(checkRateLimit(s, 'user-b', 1, 1000, LIMITS).allowed)
})

Deno.test('checkRateLimit: retryAfter counts from the oldest live event', () => {
  const s = state()
  checkRateLimit(s, 'user-a', 1, 10_000, LIMITS)
  checkRateLimit(s, 'user-a', 1, 20_000, LIMITS)
  checkRateLimit(s, 'user-a', 1, 30_000, LIMITS)
  const denied = checkRateLimit(s, 'user-a', 1, 40_000, LIMITS)
  assertFalse(denied.allowed)
  // Oldest is at 10,000; it leaves the window at 70,000 -> 30s from now.
  assertEquals(denied.retryAfterSeconds, 30)
})

Deno.test('checkRateLimit: retryAfter is never 0 when denied', () => {
  const s = state()
  for (let i = 0; i < 3; i++) checkRateLimit(s, 'user-a', 1, 1000, LIMITS)
  const denied = checkRateLimit(s, 'user-a', 1, 60_999, LIMITS)
  assertFalse(denied.allowed)
  assert(denied.retryAfterSeconds >= 1, 'Retry-After: 0 would invite an instant retry storm')
})

Deno.test('checkRateLimit: a single oversized batch cannot exceed the text budget', () => {
  const s = state()
  assertFalse(checkRateLimit(s, 'user-a', 11, 1000, LIMITS).allowed)
})

Deno.test('checkRateLimit: production defaults are 120 req / 2000 texts per minute', () => {
  assertEquals(DEFAULT_RATE_LIMITS.windowMs, 60_000)
  assertEquals(DEFAULT_RATE_LIMITS.maxRequests, 120)
  assertEquals(DEFAULT_RATE_LIMITS.maxTexts, 2000)
})

Deno.test('checkRateLimit: at the real batch size the request cap binds first', () => {
  // 120 x 8 = 960 texts, well under the 2000-text budget, so a caller sending
  // full batches is stopped by the request cap. Documents the interaction so a
  // future batch-size increase is a deliberate volume change, not a silent one.
  const s = state()
  for (let i = 0; i < 120; i++) {
    assert(checkRateLimit(s, 'user-a', 8, 1000).allowed, `batch ${i} should pass`)
  }
  const denied = checkRateLimit(s, 'user-a', 8, 1000)
  assertFalse(denied.allowed)
  assertEquals(s.get('user-a')!.reduce((n, e) => n + e.texts, 0), 960)
})

Deno.test('checkRateLimit: the text budget binds for many small requests', () => {
  const s = state()
  const limits = { windowMs: 60_000, maxRequests: 1000, maxTexts: 2000 }
  for (let i = 0; i < 250; i++) {
    assert(checkRateLimit(s, 'user-a', 8, 1000, limits).allowed, `call ${i} should pass`)
  }
  assertFalse(checkRateLimit(s, 'user-a', 8, 1000, limits).allowed)
})

// ---------------------------------------------------------------------------
// pruneRateLimitState
// ---------------------------------------------------------------------------

Deno.test('pruneRateLimitState: drops identities whose events have all expired', () => {
  const s = state()
  checkRateLimit(s, 'user-a', 1, 1000, LIMITS)
  checkRateLimit(s, 'user-b', 1, 59_000, LIMITS)
  pruneRateLimitState(s, 62_000, LIMITS)
  assertFalse(s.has('user-a'))
  assert(s.has('user-b'))
})

Deno.test('pruneRateLimitState: drops expired events from surviving identities', () => {
  const s = state()
  checkRateLimit(s, 'user-a', 1, 1000, LIMITS)
  checkRateLimit(s, 'user-a', 1, 59_000, LIMITS)
  pruneRateLimitState(s, 62_000, LIMITS)
  assertEquals(s.get('user-a')!.length, 1)
})

Deno.test('pruneRateLimitState: leaves a live window untouched', () => {
  const s = state()
  checkRateLimit(s, 'user-a', 1, 1000, LIMITS)
  pruneRateLimitState(s, 2000, LIMITS)
  assertEquals(s.get('user-a')!.length, 1)
})

// ---------------------------------------------------------------------------
// Response shape — the frozen contract two sibling packages code against
// ---------------------------------------------------------------------------

Deno.test('errorResponse: every error carries both `error` and `code`', async () => {
  const r = errorResponse('nope', 'forbidden', 403)
  assertEquals(r.status, 403)
  assertEquals(r.headers.get('Content-Type'), 'application/json')
  assertEquals(await r.json(), { error: 'nope', code: 'forbidden' })
})

Deno.test('errorResponse: 429 carries Retry-After', async () => {
  const r = errorResponse('rate limit exceeded', 'rate_limited', 429, { 'Retry-After': '30' })
  assertEquals(r.status, 429)
  assertEquals(r.headers.get('Retry-After'), '30')
  assertEquals((await r.json()).code, 'rate_limited')
})

Deno.test('jsonResponse: success shape is { model, dims, embeddings }', async () => {
  const r = jsonResponse({ model: 'gte-small', dims: 384, embeddings: [[0.1, 0.2]] })
  assertEquals(r.status, 200)
  assertEquals(await r.json(), { model: 'gte-small', dims: 384, embeddings: [[0.1, 0.2]] })
})
