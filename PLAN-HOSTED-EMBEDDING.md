# Plan: Hosted (Zero-Install) Embedding
_Created: 2026-08-13 | Type: New Feature (with a Migration component: re-embedding existing data)_
_Target branch: `release/2026-08-13-onboarding` (PR #75 open against `main`, 28/28 e2e as of this writing)_

## Goal

`remember`/`recall` — via both the CLI and the MCP server — get a working semantic-search vector with **nothing installed**: no Ollama, no OpenAI key. The hosted Supabase edge function becomes the default embedding provider for both write and read paths in both packages, hardened enough to run in prod, with all existing vectors re-embedded (they are currently the wrong model or missing entirely) and the 28/28 e2e suite still green with no local embedding provider running.

This ships as part of the current release, not a follow-up. Ryan has made that call; this plan does not re-litigate it.

## Background

Embedding today runs client-side: `packages/cli/src/lib/embedding.ts` and `packages/server/src/embeddings.ts` (hand-synced copies — the CLI one is deliberately not imported from `@tages/server` so `npm install -g @tages/cli` doesn't pull in a server runtime dependency) probe Ollama first, then optionally fall back to OpenAI behind `TAGES_OPENAI_EMBED`. A working `supabase/functions/embed/index.ts` edge function (gte-small, 384-dim, ~550ms/call) is already written and deployed to dev, verified live by Ryan, but not authorization-hardened, not rate-limited, and not wired to any client. Current prod embedding coverage is stale-model or absent: `the-remnant` 30/43, `docgen-cloud` 12/23, `longmemeval-sandbox` 2/24, `tages` 0/45 — all from a different model than gte-small, and `memory_chunks` is empty on prod. This is a full re-embed, not a fill-the-nulls job.

## Scope

**In scope:**
- Harden the edge function (project-membership auth, rate limiting, structured errors, batching, tests), redeploy to dev, deploy to prod.
- Make hosted the default provider in both `packages/cli/src/lib/embedding.ts` and `packages/server/src/embeddings.ts`, keeping the existing Ollama/OpenAI code paths intact and reachable via an explicit opt-out.
- Rewrite both backfill scripts for a full (not null-only) re-embed, with hosted batching, and run them against dev then prod.
- Update `docs/team-onboarding.md` (and check three other doc/marketing hits) to reflect zero-install-by-default.
- Re-run the existing prod e2e suite as the release gate.

**Out of scope:**
- Ripping out or restructuring the Ollama/OpenAI code paths. They stay, gated behind explicit config.
- A schema change to record which model embedded each row (`embedding_model` column) — see Open Questions. Current row counts (tens per project) make a full unconditional re-embed cheap enough that per-row resume tracking isn't worth a migration right now.
- Distributed/adversarial-proof rate limiting (Redis, KV). The edge function gets a best-effort, per-instance in-memory limiter.
- Cross-encoder reranker changes, chunk-recall RPC changes (migration 0064), or anything in `search/reranker.ts` — untouched by this plan.
- Automating `supabase functions deploy` in CI. Deploys are manual commands run by a human, as they are today.

**Ambiguities resolved:**
- Rate limiting implementation: best-effort in-memory per-verified-identity sliding window in the edge function, not a distributed store. Documented as a known limitation, not a guarantee.
- Query-embedding caching: small in-process LRU (not persisted, not shared across processes). Real benefit is in the long-lived MCP server; near-zero benefit in the one-shot CLI process, noted at the call site rather than skipped.
- Backfill resumability: "safe to re-run in full" (idempotent overwrite), not "resumes from a persisted per-row checkpoint." See Open Questions for why a schema column would be needed for the latter and why it's deferred.
- Legacy `TAGES_OPENAI_EMBED=1` behavior: kept as a backward-compatible alias for `TAGES_EMBED_PROVIDER=openai`, only when `TAGES_EMBED_PROVIDER` itself is unset, with a one-time deprecation warning to stderr.

## Findings from reading the code (load-bearing, not background color)

1. **Ollama is not actually gated by anything today.** `embedOne()` in both `embedding.ts`/`embeddings.ts` calls `embedViaOllama(text)` unconditionally, on every call, regardless of any env var — only the *OpenAI* fallback is behind `TAGES_OPENAI_EMBED`. That means two teammates today can already silently write vectors from different models into one index right now, just by one of them happening to have Ollama running locally for an unrelated project. This is the mixed-vector-space bug the plan is meant to prevent, and it's already live, ambient, and undocumented as such — `docs/team-onboarding.md`'s current "you need nothing" framing doesn't mention it. This finding directly shapes the provider-selection design below (deterministic switch, not a probe chain).
2. **The e2e harness's embedding assertion may currently be passing for the wrong reason.** `run-e2e.mjs:124-125` asserts `rowA.body?.[0]?.embedding != null` after a `remember` call, with `TAGES_SERVICE_KEY`/`SUPABASE_URL` deleted from the CLI's env but nothing that explicitly stops Ollama. Given finding 1, if Ollama happens to be running on whatever machine runs this suite, the assertion passes today via ambient Ollama — not via any zero-install guarantee. Task 8 re-runs this with Ollama explicitly stopped, which is the actual test of this release's claim.
3. **Service-role callers (the backfill scripts) cannot authenticate against the edge function as written.** The endpoint's `verify()` (`supabase/functions/embed/index.ts:63-73`) calls `/auth/v1/user` with the bearer token — that endpoint resolves a real Supabase Auth user session and returns nothing usable for a service-role JWT (no `sub` claim tied to an `auth.users` row). Both backfill scripts' documented auth precedence puts `TAGES_SERVICE_KEY` first (`packages/server/scripts/backfill-embeddings.ts:17-20`). Task 1 has to add a trusted-bypass path for the service-role key specifically, or the backfill scripts simply cannot call this endpoint at all.
4. **gte-small's real input-length limit is unverified.** Ryan's manual spike tested short text. Small encoder models (gte-small is a compact BERT-family model) typically cap far below OpenAI's 8192-token limit — often ~512 tokens. The existing `CHUNK_TARGET_CHARS = 4000` / `SAFE_SINGLE_CALL_TOKEN_LIMIT = 6000` constants (`chunking.ts:51,54`) are sized for OpenAI and are almost certainly too large to reuse as-is for hosted. This is inferred, not confirmed — Task 1 includes an empirical check against the live dev endpoint before Tasks 2/3 finalize a hosted-specific chunk size.
5. **`normalizeTo1536` already pads any dimension, confirmed by reading it** (`packages/server/src/embeddings.ts:306-316`, identical copy in `packages/cli/src/lib/embedding.ts:319-328`) — truncates + renormalizes above 1536, zero-pads below. `memory_chunks.embedding` is also declared `vector(1536)` (`supabase/migrations/0063_memory_chunks_schema.sql:64`). No schema change needed for gte-small's 384 dims, in either table. Ryan's claim holds.
6. **`remoteUpsertChunks` (`packages/server/src/sync/supabase-sync.ts:344-401`) already deletes-then-inserts per memory.** Re-running chunk backfill unconditionally (removing the current "skip if chunks already exist" check) is already safe/idempotent without new delete logic — confirmed by reading the function, not assumed.
7. **`packages/server/src/sync/supabase-sync.ts` is shared infrastructure across packages** — `packages/cli/src/sync/cli-sync.ts:38` dynamically imports the compiled server module at runtime. This plan does not touch it (the embedding *value* changes, not the write mechanics), but flagging it because a future embedding-provenance column (see Open Questions) would land there and affect both packages at once.

## Technical Approach

### Provider selection: a deterministic switch, not a probe chain

Replace the unconditional "always try Ollama" behavior (finding 1) with a single resolved provider per process, read once:

```
TAGES_EMBED_PROVIDER = hosted (default) | ollama | openai
```

`embedOne(text)` becomes a `switch` on the resolved provider — exactly one branch runs per call, with **no fallthrough to a different provider**. `embedViaOllama` and `embedSingleChunkViaOpenAI` are unchanged internally (same fetch calls, same retry/429 handling, same normalization) — they simply become unreachable unless a team explicitly sets `TAGES_EMBED_PROVIDER=ollama` or `=openai`, uniformly, which the plan documents as an all-or-nothing team decision (same framing the current docs already use for the OpenAI opt-in). This is the smallest change that removes the actual danger (ambient Ollama) without rewriting or deleting any provider implementation — satisfies "keep the blast radius on the already-verified paths small."

`generateEmbedding`'s failure contract is unchanged: any provider failing (hosted timeout, hosted 5xx, Ollama down, no OpenAI key) returns `null`, never throws. Both `recall.ts` call sites already treat `null` as "skip semantic search, fall through to trigram" — that fallback logic is untouched by this plan.

### Request/response contract (frozen here so Tasks 1, 2, 3 can proceed in parallel)

```
POST {supabaseUrl}/functions/v1/embed
Authorization: Bearer <user JWT | service-role key>
Body: { text: string, project_id: string } | { texts: string[], project_id: string }
  (project_id is NEW — required, added by Task 1)

200: { model: 'gte-small', dims: 384, embeddings: number[][] }
4xx/5xx: { error: string, code: 'unauthorized'|'forbidden'|'bad_request'|'payload_too_large'|'rate_limited'|'upstream_error' }
  (code is NEW — added by Task 1, additive to the existing `error` string)
429 responses carry `Retry-After` — already handled by the existing `fetchEmbeddingJson` retry helper in both client packages, reused as-is for the hosted path.
```

### Membership check reuses existing RLS instead of reimplementing it

Task 1 checks project membership by querying `select id from projects where id = eq(project_id)` **using the caller's own JWT**, not a service-role client. The existing SELECT policy on `projects` (`supabase/migrations/0002_rls_policies.sql:43-45`, `owner_id = auth.uid() or is_project_member(auth.uid(), id)`) already returns zero rows for a non-member — the edge function just checks row count, no new authorization logic duplicated in Deno.

### Service-role trusted bypass (finding 3)

If the bearer token matches `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` (Supabase edge functions get this automatically; constant-time compare), skip the `/auth/v1/user` check and the membership check entirely — this mirrors the exact trust boundary every script in this repo already documents for `TAGES_SERVICE_KEY` ("bypasses RLS entirely"). Without this, the backfill scripts cannot call the endpoint at all.

### Long text (finding 4)

Chunk client-side before calling hosted, reusing `chunkText()` but with a new, smaller constant sized from Task 1's empirical finding (conservative placeholder: 1500 chars if Task 1 hasn't landed a number yet), sent as one batched `texts[]` call, pooled client-side with the existing `poolChunkEmbeddings` — no new pooling logic, just a smaller chunk size feeding the existing machinery.

## Tasks

### Phase 1 — Foundation (parallel: 3 disjoint file sets)

- [ ] **Task 1: Harden the embed edge function**
  - Files: `supabase/functions/embed/index.ts` (modify), `supabase/functions/embed/index.test.ts` (new)
  - Change: add required `project_id` to the request body; membership check via the caller's own JWT against the `projects` RLS policy (see Technical Approach); service-role trusted bypass; best-effort in-memory rate limit (per verified identity, e.g. 120 req/min / 2000 texts/min, 429 + `Retry-After`); structured `code` field on every error response; extract `parseEmbedRequest`/`checkRateLimit`/`isServiceRoleBearer` as pure functions for unit testing; empirically probe gte-small's real input-length behavior against the live dev endpoint (progressively longer strings — record whether it errors, truncates, or handles it) and record the finding in a code comment for Tasks 2/3 to consume.
  - Tests: Deno unit tests for the four hardened pieces; update the existing manual curl smoke test for the new `project_id` field and error codes.
  - Depends on: nothing.
  - Effort: L (auth/security-sensitive code, 1.5x multiplier).
  - Pre-mortem: if this runs long, it's because the gte-small input-limit probe turns up a nasty case (e.g. silent truncation instead of an error) that has to be designed around before Tasks 2/3 can trust a chunk-size constant.
  - Notes: reuses the existing `is_project_member`/RLS policy rather than reimplementing membership logic in Deno.

- [ ] **Task 2: Server package — hosted provider wiring**
  - Files: `packages/server/src/embeddings.ts`, `packages/server/src/tools/remember.ts`, `packages/server/src/tools/recall.ts`, `packages/server/src/index.ts`, `packages/server/src/__tests__/embeddings.test.ts`, `packages/server/src/__tests__/remember-embedding.test.ts`, `packages/server/src/__tests__/mixed-provider-regression.test.ts` (new)
  - Change: add `TAGES_EMBED_PROVIDER` resolution + deterministic switch (see Technical Approach) in `embedOne`; new `embedViaHosted(text, opts)` using the existing `fetchEmbeddingJson` retry helper against `${supabaseUrl}/functions/v1/embed`; new `generateHostedEmbeddingsBatch(texts, opts)` export for Task 4's backfill batching; hosted-specific chunking for long text; small in-process LRU query-embedding cache in `recall.ts` (~50 entries, 5 min TTL — note in-code that this mainly benefits the long-lived MCP server, not one-shot CLI calls); thread `supabaseClient` into `handleRemember` as a new trailing optional param, mirroring `handleRecall`'s existing pattern (`recall.ts:64`, wired at `index.ts:285`) — update the `handleRemember` call site in `index.ts` (currently `handleRemember(args, projectId, cache, sync, plan, callerUserId)`) to also pass `supabaseClient || undefined`, so the fire-and-forget embedding calls at `remember.ts:308` and `remember.ts:340` can reach the hosted endpoint.
  - Tests: extend `embeddings.test.ts` with hosted-provider cases (mocked `fetch`); extend `remember-embedding.test.ts` for the new client threading; new `mixed-provider-regression.test.ts` asserting provider resolution happens once per process with no code path that lets two different providers write into the same run — the concrete regression guard for "structural, not conventional" (constraint 1 in the original brief).
  - Depends on: Task 1 for the contract (`project_id` field, chunk-size finding) — write and unit-test in parallel with Task 1; end-to-end verification against live dev waits for Task 1's deploy (Task 6).
  - Effort: L.
  - Pre-mortem: threading `supabaseClient` through `handleRemember`'s signature touches every existing call site and test that constructs that call — each needs the new optional param added without breaking; that's the likely source of overrun, not the provider-switch logic itself.

- [ ] **Task 3: CLI package — hosted provider wiring**
  - Files: `packages/cli/src/lib/embedding.ts`, `packages/cli/src/commands/remember.ts`, `packages/cli/src/commands/recall.ts`, `packages/cli/src/__tests__/embedding.test.ts`
  - Change: mirror Task 2's provider-selection logic (kept hand-synced per this file's own existing header convention — deliberately not imported from `@tages/server`). `recall.ts` already builds its own `supabase` client via `createAuthenticatedClient`; `remember.ts` needs a new, independent `createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)` call before generating the embedding, since its current Supabase client is private inside `openCliSync`'s internal `cli-sync.ts` — this mirrors `recall.ts`'s existing pattern of building its own client rather than reaching into shared internals, not a new pattern.
  - Tests: mirror Task 2's mocked-fetch cases.
  - Depends on: Task 1 (contract), same caveat as Task 2. Fully disjoint from Task 2's files — genuinely parallel, not just nominally.
  - Effort: L.
  - Pre-mortem: the real risk is silent drift between this file and Task 2's server version on provider precedence — the exact bug class this feature exists to prevent. Mitigate with an explicit line-by-line diff of the two `embedOne`/provider-switch implementations as a completion check, not just green tests in isolation.

### Phase 2 — Backfill (depends on Phase 1)

- [ ] **Task 4: Rewrite backfill scripts for full re-embed + hosted batching**
  - Files: `packages/server/scripts/backfill-embeddings.ts`, `packages/server/scripts/backfill-chunk-embeddings.ts`, `packages/server/scripts/backfill-embeddings.test.ts`, `packages/server/scripts/backfill-chunk-embeddings.test.ts`
  - Change: `backfill-embeddings.ts` — drop the `.is('embedding', null)` filter (every existing vector is stale-model, per constraint 2 in the original brief); page through **all** memories for the project; batch up to 128 decrypted plaintexts per page into one `generateHostedEmbeddingsBatch` call (Task 2's new export) instead of one `generateEmbedding` call per row; keep a non-hosted single-row path for `--provider ollama/openai` overrides. `backfill-chunk-embeddings.ts` — remove the `hasExistingChunks()` skip-if-already-chunked check (existing chunks are stale-model); `remoteUpsertChunks` already deletes-then-inserts per memory (confirmed by reading `supabase-sync.ts:344-401`, finding 6), so this is already safe to re-run once the skip check is gone — no new delete logic needed. `--dry-run` count changes from "rows with embedding IS NULL" to "total row count for the project." Add per-page progress logging (row counts are small — tens per project — so a coarse per-page line is sufficient; see Open Questions for why this isn't a persisted per-row checkpoint).
  - Tests: update both `.test.ts` files for the no-filter/no-skip queries and the batched-call path (mock the batch export).
  - Depends on: Task 1 (deployed dev endpoint to test against) + Task 2 (needs `generateHostedEmbeddingsBatch`).
  - Effort: L (1.5x multiplier: inherently serial, one project at a time by design, matching the scripts' existing single-project-scope convention).
  - Pre-mortem: the likely overrun source is a batched `texts[]` call partially failing (e.g. one oversized text trips the 400KB payload cap mid-batch) and needing retry-with-smaller-batch logic, not the query rewrite itself.

- [ ] **Task 5: Run backfill — dev, then prod** (operational, no files owned)
  - Dev: `--dry-run` for each of `the-remnant`, `docgen-cloud`, `longmemeval-sandbox`, `tages`, review counts, run for real, spot-check a few rows' dims (1536, gte-small padded from 384) and one known-related-pair cosine sanity check.
  - Prod: requires Task 6's prod deploy done first and Ryan to trigger it. Verify before/after counts per project match this plan's Background numbers so a partial failure is visible immediately.
  - Depends on: Task 4 (dev leg); Task 4 + Task 6 prod deploy (prod leg).
  - Effort: S, but manual/gated — cannot be parallelized with anything reading from the project being backfilled.

### Phase 3 — Deploy, docs, regression (overlaps Phase 2 where noted)

- [ ] **Task 6: Deploy the edge function — dev redeploy, then prod**
  - No files owned; `supabase functions deploy embed --project-ref <ref>`.
  - Dev: redeploy after Task 1 merges (`ugogdqzhhnuzwgcaovty`), re-run Task 1's smoke test against dev.
  - Prod: `wezagdgpvwfywjoxztfs`, gated on Ryan's explicit trigger but scheduled as part of this release, not deferred. Re-run the smoke test against prod immediately after deploy (confirm 401/403/200/429 paths and rate-limit headers) before Task 5's prod backfill runs.
  - Depends on: Task 1 merged (dev leg); Task 1 merged + dev backfill verified clean (prod leg).
  - Effort: S per environment.

- [ ] **Task 7: Docs — update onboarding guidance**
  - Files: `docs/team-onboarding.md` (the "Embeddings: you need nothing, but the team must not mix providers" section, current lines ~243-253 — this needs an actual rewrite: hosted runs automatically by default now, not "nothing to set up, optional"; opting OUT via `TAGES_EMBED_PROVIDER` is now the thing that requires whole-team agreement, not opting in), `README.md`, `docs/github-actions.md`, `apps/dashboard/src/components/marketing/security-page.tsx` (all four confirmed via grep to mention Ollama/`OPENAI_API_KEY`/`TAGES_OPENAI_EMBED` — check each for stale claims, update where relevant).
  - Depends on: Task 2 + Task 3 merged (env var name and behavior must be final, not speculative).
  - Effort: M (one real rewrite, three check-and-maybe-touch).

- [ ] **Task 8: Re-run the e2e regression suite (release gate)**
  - No repo files owned. Harness: `/private/tmp/claude-501/-Users-ryan/8969b3dd-e0ca-4421-bd19-fdf27e88ba7c/scratchpad/e2e/run-e2e.mjs` (drives the real built CLI + MCP server as three authenticated identities against prod; currently 28/28).
  - Rebuild CLI + server from this branch after Tasks 2, 3, and Task 6's dev deploy land. Run with Ollama explicitly stopped and no `OPENAI_API_KEY` set — this is the actual test of the zero-install claim, given finding 2 (today's pass may be riding on ambient Ollama, not a real guarantee).
  - The harness has `REF` hardcoded to prod (`run-e2e.mjs:12`) — there is no cheap dev-pointed run without a scratch copy. Treat the one prod run, after Task 6's prod deploy and Task 5's prod backfill, as the actual release gate; a dev-pointed scratch copy is optional extra signal, not a substitute.
  - Must still be 28/28, including `rowA.body?.[0]?.embedding != null` (`run-e2e.mjs:124-125`).
  - Depends on: Task 2, Task 3, Task 6 (dev + prod), Task 5 (prod backfill).
  - Effort: S (re-running working infra; if it finds a real regression, fixing that is follow-up effort not counted here).
  - Pre-mortem: if this fails, the leading suspect is the ambient-Ollama masking effect (finding 2) — the fix is in Task 2/3's provider-selection code, not the harness.

## File Ownership Matrix

| Task | Owns (creates/modifies) | Imports from (no edit) |
|---|---|---|
| 1 | `supabase/functions/embed/index.ts`, `supabase/functions/embed/index.test.ts` | — |
| 2 | `packages/server/src/embeddings.ts`, `.../tools/remember.ts`, `.../tools/recall.ts`, `.../index.ts`, 3 test files | — |
| 3 | `packages/cli/src/lib/embedding.ts`, `.../commands/remember.ts`, `.../commands/recall.ts`, test file | — |
| 4 | `packages/server/scripts/backfill-embeddings.ts`, `backfill-chunk-embeddings.ts`, 2 test files | `embeddings.ts` (Task 2's `generateHostedEmbeddingsBatch`) |
| 5, 6, 8 | none (operational) | — |
| 7 | `docs/team-onboarding.md`, `README.md`, `docs/github-actions.md`, `apps/dashboard/.../security-page.tsx` | — |

No two tasks modify the same file. Task 4's dependency on Task 2 is an import, not a shared-file edit. Gate 5c: clean.

## Open Questions

- [ ] **Should `memories`/`memory_chunks` get an `embedding_model` column so backfill can resume from a persisted per-row checkpoint instead of always re-embedding everything on re-run?** The original `embeddings.ts` header already flags this as deferred future work (finding-adjacent TODO in the file itself). Blocks: nothing in this plan — current row counts (tens per project) make an unconditional full re-embed cheap enough (well under a minute of wall time even at ~550ms/call before batching, seconds after) that the extra migration + write-path plumbing isn't worth it yet. Default if unresolved: skip it for this release; revisit if any project's row count grows enough that a full re-embed becomes slow or costly.
- [ ] **What's the actual hosted-path chunk-size constant?** Blocks: Task 2/3's long-text handling can't be finalized without Task 1's empirical gte-small input-limit finding. Default if unresolved: ship with the conservative 1500-char placeholder named in Technical Approach; tune down further only if Task 1's probe shows it's still too large.
- [ ] **Rate limit thresholds (120 req/min / 2000 texts/min) are a guess, not measured against expected team size or backfill batch volume.** Blocks: nothing directly — a too-tight limit would surface immediately as 429s during Task 5's backfill run, which is the cheapest possible place to discover it. Default if unresolved: ship the guessed numbers, adjust based on what Task 5 actually observes.

## Definition of Done

- [ ] Code written and self-reviewed across Tasks 1-4
- [ ] Tests written/updated for every changed file (Tasks 1-4), including the mixed-provider regression test (Task 2)
- [ ] Edge function deployed to dev and prod (Task 6), both smoke-tested
- [ ] Backfill run against dev and prod (Task 5), before/after counts verified
- [ ] Docs updated (Task 7)
- [ ] Prod e2e suite re-run 28/28 with no Ollama running and no OpenAI key (Task 8)
- [ ] PR opened against `main` (or added to existing PR #75) with coverage gaps noted in the description
