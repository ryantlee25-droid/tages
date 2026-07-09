# Plan: Memory Recall Fixes (LongMemEval Batch) — FINAL

_Created: 2026-07-08 | Revised: 2026-07-08 (RQ resolutions folded in) | Type: Bug Fix (product + eval harness), gates a future Refactor/Architecture phase_
_Status: Execution-ready. Only RQ5 and RQ8 remain open, both pending prod DB creds, both non-blocking._

## Goal

Get Tages memory recall from a ~56% (partly mis-measured) LongMemEval floor to a trustworthy number, and separately ship the actual product fixes that make semantic search work for the dogfooding team — without letting the two get confused with each other.

## Reader Framing (Critical — read before touching any task)

The product's real "reader" is the CLIENT AGENT (Claude Code, Cursor, etc.) that calls the `recall` MCP tool or `tages recall` CLI and reasons over the returned memory text itself. There is no LLM inside Tages' `recall` path today, and this plan does not add one to the shipped server.

The LongMemEval harness, by contrast, bolts on a SYNTHETIC READER: `eval/longmemeval/src/answer.ts` calls GPT-4o to generate an answer from retrieved memories, and a second GPT-4o call judges it. That synthetic reader is eval-only scaffolding. It never ships.

Consequence: several of tonight's "accuracy levers" (type-aware answer prompting, Chain-of-Note, per-type judging) only improve the harness's synthetic GPT-4o reader. They do NOT improve what a real client agent experiences, because a real client agent isn't running through `answer.ts` — it's reading `recall`'s raw output directly. Every task below is tagged **PRODUCT** (ships, changes what Claude Code/Cursor/CLI users get) or **EVAL-ONLY** (changes only the benchmark number).

**Hard rule for reporting results:** do not report a LongMemEval `overall_accuracy` delta as a product improvement unless it is attributable to a task tagged PRODUCT, or to the retrieval-quality metric (Task 6, recall@k). If the delta comes from an EVAL-ONLY task, say so explicitly — it moved the benchmark, not the product.

### What actually improves for the dogfooding team vs. what only improves the benchmark number

| Improves for the dogfooding team (PRODUCT) | Only improves the LongMemEval number (EVAL-ONLY) |
|---|---|
| Task 8 — embeddings actually get written, so semantic search stops being a silent no-op | Task 1 — per-type judge fixes a false 0% scoring bug |
| Task 9 — embedding-vector correctness guard prevents future silent corruption | Task 2 — type-aware answer prompt (date arithmetic, preference phrasing) for the synthetic reader |
| Task 10 — CLI semantic recall gets the same Ollama→OpenAI fallback as the server | Task 3 — retrieved-memory capture in results JSON (debugging aid for the harness) |
| Task 11 — existing dogfood-sandbox memories get backfilled with embeddings | Task 4 — per-round ingestion granularity (harness ingestion strategy only) |
| Task 12 — migration 0058 no longer breaks a fresh `db push` | Task 5 — Chain-of-Note reading step inside the harness's synthetic reader |
| Task 13 — `recall` output becomes structured/citable, which the real client agent (Claude Code/Cursor) can actually use | Task 7 — stale README doc correction |
| — | Task 6 — retrieval-quality metric is harness *code*, but unlike `overall_accuracy` its number (recall@k) genuinely reflects product retrieval quality — cite this number, not the synthetic reader's accuracy, when claiming a product win |

## Background

Tonight's benchmarking run (`eval/longmemeval/results/tages-semantic-v2-20260708.json`, n=50, seed=42) scored 56.0% overall, with `single-session-preference` at a **false 0%** (30/500 questions in the full oracle set) because the harness judges every question type against the same "same factual content" rubric — but LongMemEval's own oracle data encodes preference-question ground truth as a rubric description, not a factual answer (verified: `question_id 8a2466db`, answer field reads "The user would prefer responses that suggest resources specifically tailored to Adobe Premiere Pro..."). Separately, code inspection found the pgvector `embedding` column has never been populated by any write path in the product — `generateEmbedding` is called only in `recall.ts` (query side); nothing on the `remember` write path ever populates it. Semantic search has been silently trigram-only since the feature shipped.

Nine research questions from the first pass are now resolved (see Research Questions section). This revision folds those resolutions into the task list, adds the newly-unblocked tasks, and restructures the plan around the PRODUCT vs EVAL-ONLY split above.

## Scope

**In scope:**
- Eval harness (EVAL-ONLY, Phase 1): per-type judge, type-aware answer prompting, retrieved-memory capture, per-round ingestion granularity, Chain-of-Note reading step in the harness's synthetic reader, retrieval-quality metric, stale doc fix (Tasks 1–7)
- Product (PRODUCT, Phase 2): document-embedding write path, embedding-vector correctness guard, CLI/server embedding-provider parity, sandbox-scoped embedding backfill, migration 0058 DDL fix, structured/citable `recall` output for the client agent (Tasks 8–13)

**Out of scope (this plan):**
- Adding an LLM reading step to the shipped `recall` MCP tool (RQ2a — explicitly rejected; latency/cost hit on every client call for every tool, no evidence it beats a well-structured raw-passage response for a reasoning client agent)
- Time-aware indexing, key expansion, reranking/HyDE/knowledge-graph — still deferred to a future Phase 4 architecture plan
- Re-running the full 500-question LongMemEval benchmark (a validation step after these fixes land, tracked in Definition of Done, not a build task)
- Dashboard UI changes
- `tages recall --json` (pre-existing TODO in `eval/longmemeval/src/memory.ts`, unrelated to this batch)
- Full-production embedding backfill (Task 11 is sandbox-scoped only; full-prod backfill is sized once RQ8 answers the row count — see Research Questions)
- A corrective forward migration for 0058 against live prod (only added if RQ5 later proves prod needs one — see Research Questions)
- Any work already claimed by `PLAN.md` (multi-agent instrumentation, migration 0059) or `PLAN-INSTRUMENTED-HARNESS.md` (harness_tool_events, also migration 0059)

**Ambiguities resolved:**
- Phase 1 (eval-harness) vs. Phase 2 (product): confirmed disjoint file sets (`eval/longmemeval/src/*` + its README vs. `packages/server`, `packages/cli`, `packages/shared`, `supabase/migrations`). **Ryan confirmed: run both phases in parallel** — this is no longer a default, it's a decision (RQ4 resolved).
- Migration 0058: fix the DDL in place now (safe under any current prod state — see Task 12). No new migration number is created by this plan (RQ6 resolved — do not hardcode 0059 or any number; both `PLAN.md` and `PLAN-INSTRUMENTED-HARNESS.md` already claim 0059 for unrelated work).
- Embedder/dimension: stay on the existing `vector(1536)` column and existing Ollama→OpenAI provider chain (RQ3 resolved — changing dimension means dropping the HNSW index, a full re-embed, and dropping/recreating `semantic_recall`/`hybrid_recall` RPCs, and the embedder isn't the accuracy lever anyway). Instead, harden `normalizeTo1536` against future dimension changes (Task 9).
- CLI provider parity (Task 10): match the server's Ollama → OpenAI fallback order, implemented as a CLI-local module, not a cross-package import from `@tages/server` (RQ7 resolved — a runtime dependency on `@tages/server` breaks `npm install -g @tages/cli` standalone installs).
- Turn/round granularity (RQ1 resolved): eval-harness-ingestion-strategy-only. Does not touch the `remember` tool's schema, the `MemoryType` enum, or tier-limit enforcement in `remember.ts`.
- Chain-of-Note reading step (RQ2 resolved): lives only in the eval harness's `answer.ts`, not in the shipped `recall` tool. The shipped-product equivalent is Task 13's response shaping, which is a different (much cheaper) mechanism — no LLM call, just structure + an optional static "note-then-answer" guidance string.

## Type Dependencies

- `Memory` interface in `packages/shared/src/types.ts` (confirmed by reading the file, lines 39-67) — currently has **no `embedding` field**. Shared by 15 dashboard files and 14 CLI files that import `@tages/shared`, plus every server tool. Task 8 adds `embedding?: number[]` as an **optional** field — low blast radius, but flagged as a shared-infrastructure edit.
- `MemoryType` (11 values) in `packages/shared/src/types.ts` — unaffected. Turn-granularity (Task 4) is confirmed eval-harness-only and never touches this enum or `remember.ts`'s tier-limit checks.
- `QuestionType` (6 values) in `eval/longmemeval/src/types.ts` — used by Tasks 1, 2. No separate "abstention" variant exists — abstention questions are signaled only by a `_abs` suffix on `question_id` (confirmed: 30 of them in the oracle). Task 1 must detect this via `question_id.endsWith('_abs')`.
- `RunResult['details']` array in `eval/longmemeval/src/types.ts` (currently: `question_id, question_type, correct, model_answer, ground_truth, recalled_memory_count`, confirmed lines 39-46) — Task 3 extends it with `recalled_memories: string[]` and `gold_session_ids: string[]`; Task 6 extends it further with per-question recall@k data. Both are additive/optional — no breaking change to existing result-JSON consumers.
- `MemoryStore` interface in `eval/longmemeval/src/memory.ts` (confirmed lines 24-29: `ingest`, `recall`, `clear`, `backend`) — Task 4 changes `TagesCliStore.ingest`'s internal key scheme (`longmemeval-${qid}-s${i}` → `longmemeval-${qid}-s${i}-t${j}`) but the interface shape itself is unchanged.

## Technical Approach

**Phase 1 — Eval harness (EVAL-ONLY, runs in parallel with Phase 2).** All changes confined to `eval/longmemeval/src/` and its README. Fixes the judge/prompt bugs (Tasks 1–3), then the two newly-unblocked harness improvements (Tasks 4–5, per-round ingestion and Chain-of-Note), then adds the one metric that actually reflects product retrieval quality (Task 6), then corrects stale docs (Task 7). Internally sequential — Tasks 1-2-3-4-5-6-7 touch overlapping files (`answer.ts`, `run.ts`, `memory.ts`, `types.ts`), so run them in one lane, one developer/session, not split across parallel Howlers. This whole lane can run concurrently with Phase 2 since the file sets never overlap.

**Phase 2 — Product (embeddings write path + related fixes, runs in parallel with Phase 1).** Close the loop on `generateEmbedding` → local cache → Supabase sync, which today only runs on the query side (Task 8). Reuse the existing dirty-flag + async-sync pattern already in place for non-embedding fields — do not add a blocking network round-trip to `remember()`'s response path. Harden the embedding-normalization code against future dimension mismatches (Task 9). Fix the CLI's Ollama-only recall path via a CLI-local module (Task 10). Backfill existing dogfood-sandbox memories (Task 11, depends on Task 8). Fix the migration 0058 DDL bug (Task 12, independent). Reshape `recall`'s output for the real reader — the calling client agent — with stable citable IDs and provenance (Task 13, independent). Within Phase 2, Tasks 8, 9, 10, 12, 13 have no file overlap and can run as parallel Howlers; only Task 11 has a hard dependency (on Task 8).

**Phase 3 — Re-baseline.** After Phase 1 + Phase 2 land, re-run the 50-question calibration, then the full 500-question set. Report both `overall_accuracy` (with the caveat above) and the new recall@k retrieval-quality metric (Task 6) as separate numbers. Not a build task — tracked in Definition of Done.

**Phase 4 — Architecture (still research-gated, still not in this plan's task list).** Time-aware indexing, key expansion, reranking/HyDE/knowledge-graph. Write a follow-up plan if/when those become priorities.

## File Ownership Matrix

| Task | Creates | Modifies |
|------|---------|----------|
| 1 — Per-type judge (EVAL-ONLY) | — | `eval/longmemeval/src/prompts.ts`, `eval/longmemeval/src/answer.ts`, `eval/longmemeval/src/run.ts` |
| 2 — Type-aware answer prompt (EVAL-ONLY) | — | `eval/longmemeval/src/prompts.ts`, `eval/longmemeval/src/answer.ts`, `eval/longmemeval/src/run.ts` |
| 3 — Capture retrieved memories (EVAL-ONLY) | — | `eval/longmemeval/src/run.ts`, `eval/longmemeval/src/types.ts` |
| 4 — Per-round ingestion granularity (EVAL-ONLY) | — | `eval/longmemeval/src/memory.ts`, `eval/longmemeval/src/run.ts` |
| 5 — Chain-of-Note in harness reader (EVAL-ONLY) | — | `eval/longmemeval/src/answer.ts`, `eval/longmemeval/src/prompts.ts` |
| 6 — Retrieval-quality metric (EVAL-ONLY, product-reflecting number) | — | `eval/longmemeval/src/run.ts`, `eval/longmemeval/src/types.ts` |
| 7 — Fix stale harness README (EVAL-ONLY) | — | `eval/longmemeval/README.md` |
| 8 — Embeddings write path (PRODUCT) | — | `packages/shared/src/types.ts`, `packages/server/src/tools/remember.ts`, `packages/server/src/sync/supabase-sync.ts` |
| 9 — Embedding-vector correctness guard (PRODUCT) | — | `packages/server/src/embeddings.ts` |
| 10 — CLI embedding provider parity (PRODUCT) | `packages/cli/src/lib/embedding.ts` | `packages/cli/src/commands/recall.ts` |
| 11 — Sandbox embedding backfill (PRODUCT) | `packages/server/scripts/backfill-embeddings.ts` | `packages/server/src/sync/supabase-sync.ts` |
| 12 — Migration 0058 DDL fix (PRODUCT) | — | `supabase/migrations/0058_drop_provenance_user_id.sql` |
| 13 — Recall output shaping for client reader (PRODUCT) | — | `packages/server/src/tools/recall.ts`, `packages/server/src/index.ts` |

**File conflicts and resolution:**
- Tasks 1, 2, 3, 4, 5, 6 all touch some combination of `answer.ts` / `run.ts` / `memory.ts` / `types.ts` / `prompts.ts` in the eval package. Resolution: **sequential, one lane** — 1 → 2 → 3 → 4 → 5 → 6 → 7, same developer/session, not split across parallel Howlers.
- Tasks 8 and 11 both touch `supabase-sync.ts`. Resolution: **sequential** — Task 11 depends on Task 8 and reuses the helper Task 8 introduces.
- Tasks 8/9/10/12/13 have no other file overlaps and can run as independent parallel Howlers within Phase 2.
- Phase 1 and Phase 2 never touch the same file (confirmed against both matrices above) — safe to run fully concurrently per RQ4.

## Tasks

### Phase 1 — Eval Harness (EVAL-ONLY: trustworthy baseline, does not ship to users)

- [ ] **Task 1: Per-type judge branching** (EVAL-ONLY) — Replace the single universal `JUDGE_SYSTEM_PROMPT` with type-aware judging: (a) `single-session-preference` — judge whether the candidate answer *satisfies the rubric* in `ground_truth` (the oracle's `answer` field is itself the rubric text for this type), not factual equality; (b) abstention questions (`question_id` ends `_abs`) — judge whether the candidate correctly declined to answer, regardless of literal ground truth text; (c) `temporal-reasoning` — allow off-by-one-day tolerance before marking incorrect.
  - Files: `eval/longmemeval/src/prompts.ts`, `eval/longmemeval/src/answer.ts` (`judge()` takes `questionType` + `isAbstention` params), `eval/longmemeval/src/run.ts` (pass `q.question_type` and `q.question_id.endsWith('_abs')` into `judge()`)
  - Tests: unit tests (mocked OpenAI client) covering all 4 branches — rubric-pass, rubric-fail, abstention-correct-decline, temporal off-by-one-forgiven — plus a regression check that factual-equality is unchanged for other types. Re-run the 50-question calibration and confirm `single-session-preference` accuracy moves off 0%.
  - Depends on: nothing
  - Effort: M
  - Pre-mortem: If this takes 3x longer, it will be because getting the abstention detection and rubric-judge prompt to agree with human judgment on edge cases requires several iterations against real GPT-4o outputs, not just mocked unit tests.
  - Notes: This is EVAL-ONLY. Fixing the false-0% scoring bug makes the benchmark trustworthy; it does not change how `recall`/`remember` behave for real users.

- [ ] **Task 2: Type-aware answer prompt** (EVAL-ONLY) — `ANSWER_SYSTEM_PROMPT` is factual-only today and can't do date arithmetic, numeric aggregation, or preference-style responses (confirmed failures: "$5,000" + "$150" never summed to $5,150; trip ordering reversed; "9 days ago" not computed). Add explicit date-arithmetic and numeric-aggregation instructions, plus a preference-response mode selected when `question_type === 'single-session-preference'`.
  - Files: `eval/longmemeval/src/prompts.ts`, `eval/longmemeval/src/answer.ts` (`generateAnswer()` takes `questionType`), `eval/longmemeval/src/run.ts` (pass `q.question_type` through)
  - Tests: unit tests on prompt-building functions (deterministic string assertions per type). Integration: re-run the 50-question calibration, confirm the three known-failing question_ids now produce correct arithmetic, no regression on `single-session-user`/`single-session-assistant` (currently 100%).
  - Depends on: Task 1 (same files, sequential)
  - Effort: M
  - Pre-mortem: If this takes 3x longer, it will be because prompt-tuning for reliable arithmetic against real GPT-4o outputs takes more iterations than expected, each requiring a full calibration re-run.
  - Notes: EVAL-ONLY — this improves the harness's synthetic GPT-4o reader's ability to do arithmetic on retrieved text. A real client agent (Claude Code/Cursor) already does its own arithmetic; this task does not change that capability.

- [ ] **Task 3: Capture retrieved memories in results** (EVAL-ONLY) — `run.ts` currently stores only `recalled_memory_count`, discarding the retrieved strings, so retrieval-miss vs. answer-generation-error can't be distinguished from the results JSON.
  - Files: `eval/longmemeval/src/run.ts` (store `memories` array and `q.answer_session_ids` in the pushed detail object), `eval/longmemeval/src/types.ts` (extend `RunResult['details']` entry with `recalled_memories: string[]` and `gold_session_ids: string[]`)
  - Tests: run a small real run (`--n 5`) and assert output JSON's `details[].recalled_memories` is populated and non-empty for at least one question, and `gold_session_ids` matches the oracle's `answer_session_ids`.
  - Depends on: Task 2 (same files, sequential)
  - Effort: S
  - Notes: `answer_session_ids` already exists on `LongMemEvalQuestion` (confirmed `types.ts` line 24) — no dataset change needed. This plumbing is also a prerequisite for Task 6's recall@k metric.

- [ ] **Task 4: Per-round ingestion granularity** (EVAL-ONLY, RQ1 resolved) — Change `TagesCliStore.ingest` in `memory.ts` from one memory per whole session to one memory per turn/round: iterate `q.haystack_sessions[i]` (a `Turn[]`, confirmed `types.ts` line 23) and call `tages remember` once per turn, keyed `longmemeval-${q.question_id}-s${i}-t${j}`. Each per-round memory's text must still carry `[session=<id> date=<date>]` (same convention `sessionToText` already uses) so Task 6's recall@k metric can still attribute a recalled round back to its gold session id. Bump `topK` in `run.ts` accordingly (turn-level ingestion multiplies row count per question ~5-20x versus session-level; a `topK=10` cutoff tuned for session-level retrieval will under-retrieve at turn-level — start at `topK=30` and confirm via calibration). Also fix the silent-failure trap: `execFileSync(..., { stdio: 'ignore' })` in `ingest()` swallows the free-tier 10k-memory-limit rejection message from `remember`, so turns silently fail to store past the cap with no error surfaced. Run the eval project on an uncapped (Pro-tier or limit-raised) plan so per-round ingestion doesn't silently drop turns for haystacks with many sessions.
  - Files: `eval/longmemeval/src/memory.ts` (`TagesCliStore.ingest`, `clear` must still track and forget every per-round key), `eval/longmemeval/src/run.ts` (topK default/override)
  - Tests: `--n 5` real run against the uncapped eval sandbox project; assert per-question memory count in Supabase/local cache matches total turn count (not session count); assert `clear()` removes all per-round keys (no orphaned rows between questions); recalibrate and record whether accuracy moves versus session-level ingestion.
  - Depends on: Task 3 (same files, sequential in the Phase 1 lane)
  - Effort: M
  - Pre-mortem: If this takes 3x longer, it will be because turn-level ingestion multiplies API/network calls per question (one `remember` shell-out per turn instead of per session), which could make the 50-question calibration run 5-20x slower and hit rate limits or timeouts that weren't a factor at session-level granularity.
  - Notes: Confirmed eval-harness-ingestion-strategy-only — does not touch the `remember` tool's schema, `MemoryType` enum, or `remember.ts`'s tier-limit enforcement (those stay exactly as they are for real product users).

- [ ] **Task 5: Chain-of-Note reading step in the harness's synthetic reader** (EVAL-ONLY, RQ2b resolved) — Add a Chain-of-Note-style intermediate step to `generateAnswer()` in `answer.ts`: prompt GPT-4o to first write brief per-memory relevance notes, then produce the final answer conditioned on those notes (single extra reasoning pass, not a separate LLM call if achievable via one prompt with a "notes then answer" structure — otherwise two calls, accepting the added cost/latency since this only runs inside the harness, never in production).
  - Files: `eval/longmemeval/src/answer.ts` (`generateAnswer()`), `eval/longmemeval/src/prompts.ts` (new note-taking prompt template)
  - Tests: unit test asserting the note-taking step runs before answer synthesis (mocked client, assert message structure/order); integration: re-run the 50-question calibration and record the accuracy delta attributable to this task specifically, separate from Tasks 1-2's deltas.
  - Depends on: Task 2 (both modify `generateAnswer()` in `answer.ts`, sequential)
  - Effort: M
  - Pre-mortem: If this takes 3x longer, it will be because isolating this task's accuracy contribution from Tasks 1/2's changes requires careful before/after calibration bookkeeping, and prompt tuning for reliable note quality takes iteration.
  - Notes: EVAL-ONLY, explicitly not a product task (see RQ2a in Research Questions — do not port this into the shipped `recall` tool). Do not report any accuracy gain from this task as a Tages product improvement in any summary or README.

- [ ] **Task 6: Retrieval-quality metric (recall@k)** (EVAL-ONLY infra, product-reflecting metric, RQ2d resolved) — Add a metric independent of the synthetic-reader accuracy: for each question, check whether at least one recalled memory's embedded session id (parsed from the `[session=<id> ...]` tag Task 3/4 already capture in `recalled_memories`) is in `q.answer_session_ids` (gold evidence sessions). Report `recall_at_k` per question and aggregate (overall and by question type) in the result JSON, printed separately from `overall_accuracy` in the run summary.
  - Files: `eval/longmemeval/src/run.ts` (compute and store per-question `recalled_gold_hit: boolean` and aggregate `recall_at_k`), `eval/longmemeval/src/types.ts` (extend `RunResult` with `recall_at_k: number` and `recall_at_k_by_type`, extend `details[]` entry with `recalled_gold_hit: boolean`)
  - Tests: unit test on the session-id-parsing regex against sample `recalled_memories` strings (session id present / absent / malformed tag); integration test on a small real run confirming `recall_at_k` is computed and printed, and manually spot-check 2-3 questions' `recalled_gold_hit` against their `recalled_memories` content.
  - Depends on: Task 4 (needs Task 3's `recalled_memories`/`gold_session_ids` fields and Task 4's confirmation that per-round text still carries the session tag; sequential, same files)
  - Effort: M
  - Pre-mortem: If this takes 3x longer, it will be because the session-id tag parsing is a plain-text regex against LLM-adjacent free text (the memory value), and edge cases (missing tag, malformed session id, multiple sessions concatenated in one recalled memory) will need defensive handling to avoid false negatives skewing the metric.
  - Notes: This is the one number from this whole plan that genuinely reflects product retrieval quality — it measures whether the right evidence was retrieved, not whether GPT-4o phrased an answer correctly. When reporting results, cite `recall_at_k` (not `overall_accuracy`) as the number that speaks to what a real client agent would get back from `recall`.

- [ ] **Task 7: Fix stale harness README** (EVAL-ONLY, RQ9 resolved) — `README.md` (lines 27-28) describes ingestion as "iterate each turn... with metadata `{session_id, turn_index, date}`" and recall as using "a 3-turn context window heuristic" — neither is implemented (`memory.ts` ingests one memory per whole session with no structured metadata, and `recall()` is a flat top-k call with no windowing). Mark these as planned/v2, not implemented, and update the methodology section to describe what Tasks 1-6 above actually land.
  - Files: `eval/longmemeval/README.md`
  - Tests: none (doc-only) — self-review that the corrected methodology section matches the actual code path after Tasks 1-6 land.
  - Depends on: Task 6 (describes the final Phase 1 state; do last in the lane)
  - Effort: S
  - Notes: Small, low-risk, but do not skip — stale methodology docs are exactly what caused the false-0% bug to go unnoticed for as long as it did.

### Phase 2 — Product (PRODUCT: ships to the dogfooding team)

- [ ] **Task 8: Generate, store, and sync document embeddings on write** (PRODUCT) — The #1 product bug. `handleRemember` (`packages/server/src/tools/remember.ts`, confirmed lines 1-149) never calls `generateEmbedding`; it only calls `cache.upsertMemory` (no embedding) and `sync.remoteInsert(memory)`. The `Memory` type (`packages/shared/src/types.ts`, confirmed lines 39-67) has no `embedding` field at all. Fix: add `embedding?: number[]` to `Memory`; in `remember.ts`, generate the embedding from `plaintextForIndex` (line 111, the same pre-encryption plaintext capture already used for tokenization — embeddings must never be generated from ciphertext) and pass it through to the cache/sync layer so it lands in the local SQLite row and the Supabase `memories.embedding` column via a pgvector literal string (`[${embedding.join(',')}]`, matching the existing pattern in `remoteHybridRecall`). Do this as a fire-and-forget step after the local upsert completes — do not block the MCP tool's response on the embedding network call, mirroring the existing dirty-flag + async-sync architecture already used for non-embedding fields.
  - Files: `packages/shared/src/types.ts`, `packages/server/src/tools/remember.ts`, `packages/server/src/sync/supabase-sync.ts`
  - Tests: extend cache test coverage to confirm `remember` populates the embedding column locally; add a `remember.ts` test with a mocked `generateEmbedding` confirming it's called with plaintext (not ciphertext) when encryption is enabled; add a `supabase-sync` test confirming the row mapper round-trips an embedding correctly.
  - Depends on: nothing
  - Effort: L
  - Pre-mortem: If this takes 3x longer, it will be because the fire-and-forget async design needs to interact correctly with the existing WAL/dirty-flag recovery path in `supabase-sync.ts` without introducing a race where a memory syncs to Supabase before its embedding is computed, silently leaving the remote row's embedding null on the first sync pass.
  - Notes: This is the highest-priority fix for dogfood — semantic search is currently a silent no-op product-wide (CLI and MCP both). Does not require a new migration; `vector(1536)` already exists (`0008_pgvector.sql`).

- [ ] **Task 9: Embedding-vector correctness guard** (PRODUCT, RQ3 resolved) — `normalizeTo1536` in `packages/server/src/embeddings.ts` (confirmed lines 67-72) truncates any embedding over 1536 dims via `.slice(0, 1536)` with no renormalization. A truncated vector is no longer unit-length, which silently corrupts cosine-similarity rankings if a >1536-dim model (e.g. OpenAI 3-large at 3072) is ever wired in later. Fix by either renormalizing after truncation (divide by the new L2 norm) or rejecting/erroring on >1536-dim input rather than silently slicing it. Given this plan keeps the current 1536-dim provider chain (Ollama nomic-embed-text, OpenAI text-embedding-3-small — both already ≤1536), this is a forward-looking guard, not a fix for an active bug.
  - Files: `packages/server/src/embeddings.ts`
  - Tests: unit test confirming a >1536-dim mock embedding is either renormalized correctly (L2 norm ≈ 1 after truncation) or rejected with a clear error, and that the existing 1536-dim and <1536-dim (pad) paths are unchanged.
  - Depends on: nothing (no file overlap with Task 8)
  - Effort: S
  - Notes: Standalone per RQ3's resolution rather than folded into Task 8 — different function, different risk (future-proofing vs. today's silent-no-op bug), no reason to couple their review/land timing.

- [ ] **Task 10: CLI embedding provider parity via CLI-local module** (PRODUCT, RQ7 resolved) — `packages/cli/src/commands/recall.ts` (confirmed lines 74-99) hardcodes a single Ollama call (`http://localhost:11434`, `nomic-embed-text`) with no fallback and no error path other than silently falling back to trigram-only. `packages/server/src/embeddings.ts` has an Ollama → OpenAI fallback chain the CLI lacks. Create a CLI-local `packages/cli/src/lib/embedding.ts` (~30 lines) mirroring the server's fallback logic and the `normalizeTo1536` padding, and call it from `recall.ts` in place of the inline fetch block. Do NOT import from `@tages/server` — that would put a runtime dependency on the server package into a standalone-installable CLI (`npm install -g @tages/cli`), breaking that install story.
  - Files: `packages/cli/src/lib/embedding.ts` (new), `packages/cli/src/commands/recall.ts`
  - Tests: add a CLI recall test (mocking `fetch`) confirming that when the Ollama call fails/times out and `OPENAI_API_KEY` is set, the OpenAI embedding path is used and `searchMethod` still reports `hybrid`; confirm the existing Ollama-only-success case (`recall.test.ts`) is unaffected.
  - Depends on: nothing (disjoint files from Task 8; runs in parallel)
  - Effort: M
  - Pre-mortem: If this takes 3x longer, it will be because keeping the CLI-local copy and the server's `embeddings.ts` logically in sync (same fallback order, same timeout values, same normalization) without a shared import requires careful side-by-side review, and future drift between the two copies is a known cost of this approach.
  - Notes: Flag "promote to `@tages/shared`" as a future cleanup once there's a second CLI-local consumer of embedding logic — not in scope now, per RQ7's resolution favoring standalone-install safety over DRY.

- [ ] **Task 11: Sandbox-scoped one-time embedding backfill** (PRODUCT, RQ5/RQ8-adjacent, scope narrowed) — Once Task 8 ships, all memories written before that point still have `embedding IS NULL`. Add an idempotent backfill script that pages through `memories WHERE embedding IS NULL`, generates embeddings from plaintext (decrypting first if `encrypted = true`, matching Task 8's plaintext-only rule), and updates the row via the same pgvector-literal serialization Task 8 introduces. **Scope for this task: the dogfood sandbox project(s) only.** Full-production backfill across all Supabase projects is explicitly out of scope until RQ8 answers the actual row count/cost (see Research Questions) — running this unscoped against prod without that number risks an unbounded-cost, unbounded-duration job right before the dogfood deadline.
  - Files: `packages/server/scripts/backfill-embeddings.ts` (new); modify `packages/server/src/sync/supabase-sync.ts` to export the embedding-serialization helper Task 8 introduces, for reuse instead of duplicating it
  - Tests: dry-run mode that reports row count and estimated API cost without writing; a real run against the dogfood sandbox project confirming `embedding IS NULL` count drops to 0 for that project and no plaintext leaks into logs.
  - Depends on: Task 8 (reuses its serialization helper; sequential, both touch `supabase-sync.ts`)
  - Effort: M (base S, ×1.5 for inherently-serial one-time data migration; not ×1.5 again for prod-wide scope since that's now explicitly deferred)
  - Pre-mortem: If this fails or takes 3x longer, it will be because even sandbox-scoped, the per-row embedding API cost/time within that one project is still unmeasured until run — budget a dry-run first, don't run live blind.
  - Notes: Once RQ8 answers the full-prod row count, size a follow-up "Task 11b: full-prod embedding backfill" as its own task — do not silently expand this task's scope to cover prod without re-sizing effort first.

- [ ] **Task 12: Fix migration 0058 DDL bug** (PRODUCT) — `supabase/migrations/0058_drop_provenance_user_id.sql` (confirmed, full file read) uses `create or replace function` to change `get_memory_provenance`'s `returns table(...)` shape (0057 defines it with `user_id`, 0058's `returns table` omits it). Postgres rejects `CREATE OR REPLACE FUNCTION` when the return type changes (SQLSTATE 42P13) — a fresh `db push` from zero breaks at 0058. Fix by rewriting as `DROP FUNCTION IF EXISTS get_memory_provenance(uuid);` followed by `CREATE FUNCTION ...` (not `OR REPLACE`) — correct regardless of prod's actual current state (RQ5 pending, but this fix is safe either way).
  - Files: `supabase/migrations/0058_drop_provenance_user_id.sql`
  - Tests: apply the corrected migration to a scratch/local Supabase instance from a clean `0001` state (`supabase db reset` or equivalent) and confirm it succeeds; confirm `get_memory_provenance` still has zero callers in the codebase (re-run the grep documented in the migration's own comment header: `grep -r "get_memory_provenance" apps/dashboard/src/ packages/`) so this remains a zero-risk change.
  - Depends on: nothing
  - Effort: M (base S, ×1.5 for touching a database migration/prod schema)
  - Notes: Do not create a new migration number for this fix. Per RQ6, if RQ5 later confirms prod needs a corrective forward migration, its number must be resolved at execution time against whichever of `PLAN.md` or `PLAN-INSTRUMENTED-HARNESS.md` has landed its 0059 first — never hardcode 0059 or 0060 in this task.

- [ ] **Task 13: Shape `recall` output for the client-agent reader** (PRODUCT, RQ2c resolved) — The real reader of `recall`'s output is the calling client agent (Claude Code, Cursor, etc.), which already reasons over returned text — it doesn't need Tages to pre-digest the answer, but it does need the output to be citable and disambiguated. Today `formatResults`/`formatMemory` in `packages/server/src/tools/recall.ts` (confirmed lines 111-163) emit a flat numbered list (`1. [type] key`, value, optional file/condition/tag lines) with no stable identifier, no explicit source/provenance, and no per-memory date. Add: (a) a stable `[n]` passage ID per result that's referenceable in the same response (already implicitly `i+1` — make it explicit and call it out in a one-line preamble so the client agent knows it can cite `[2]` etc.); (b) explicit `source` (agent/user, from `Memory.source`) and a formatted date (`Memory.updatedAt`) per result; (c) optionally, a static (zero-latency, zero-provider-call) one-line "reading guidance" scaffold in the tool's description string (`packages/server/src/index.ts`, confirmed line 273) that nudges the calling agent toward a note-then-answer pattern (e.g., "Before answering, briefly note which numbered passage(s) support your answer.") — this is a prompt-engineering nudge to the CLIENT's own reasoning, not an LLM call inside Tages, so it costs nothing at runtime.
  - Files: `packages/server/src/tools/recall.ts`, `packages/server/src/index.ts`
  - Tests: unit test on `formatResults`/`formatMemory` output confirming each result includes a `[n]` id, source, and date in a stable, parseable format; confirm existing fields (filePaths, conditions, crossSystemRefs, executionFlow, examples, tags) are preserved unchanged; snapshot test on the full formatted string for a multi-result case to catch accidental format drift.
  - Depends on: nothing (no file overlap with Task 8's `remember.ts`/`types.ts`/`supabase-sync.ts`)
  - Effort: L
  - Pre-mortem: If this takes 3x longer, it will be because changing `recall`'s output format is a de facto contract change for every existing client agent already parsing today's format conversationally — needs care that the new provenance/ID fields are additive and don't break agents that just read the value text, and needs sign-off that this doesn't regress the dashboard's memory browser if it also renders `recall`-shaped text anywhere (verify before landing).
  - Notes: This is the PRODUCT-side answer to RQ2 — it's the cheap, no-LLM equivalent of Chain-of-Note, aimed at the actual reader (the client agent), not the synthetic GPT-4o reader in the eval harness (that's Task 5, EVAL-ONLY). Do not conflate the two when reporting outcomes.

## Research Questions

RQ1–RQ4, RQ6, RQ7, RQ9 are resolved above and folded into Tasks 1–13. Two remain open, both pending prod DB credentials, both non-blocking for this plan:

- [ ] **RQ5 — Migration 0058's actual prod state.** `TAGES-IMPROVEMENT-PLAN.md` claims migration head 0058 "matches prod," but the DDL bug in Task 12 should make that impossible under standard Postgres semantics (a return-type change via `CREATE OR REPLACE FUNCTION` is a hard error). Run `supabase migration list --linked` against prod (`wezagdgpvwfywjoxztfs`) once creds are available, to determine whether prod is actually stuck on 0057's function signature, has an out-of-band fix already applied, or the claim is stale. — Blocks: whether a corrective forward migration is needed against live prod in addition to Task 12's source-file fix. Non-blocking for Task 12 itself (safe under any prod state).
- [ ] **RQ8 — Full backfill scope and cost.** How many live memories across all Supabase projects currently have `embedding IS NULL` (needs a prod count query: `SELECT count(*) FROM memories WHERE embedding IS NULL`), and what's an acceptable time/API-cost budget for a full-prod backfill? — Blocks: sizing "Task 11b: full-prod embedding backfill" (not in this plan's task list). Non-blocking for Task 11, which is explicitly scoped to the dogfood sandbox project only.

## Definition of Done

- [ ] Phase 1 (Tasks 1-7) code written, tests passing, calibration re-run shows `single-session-preference` off 0%, no regression on currently-100% types, and `recall_at_k` (Task 6) reported alongside `overall_accuracy`
- [ ] Phase 2 (Tasks 8-13) code written, tests passing, embedding column populated on new `remember` calls, backfill completed on the dogfood sandbox project(s) (Task 11), `recall` output includes stable IDs/source/date (Task 13)
- [ ] Quality gates pass (code review, tests, security review) — particularly: confirm no plaintext-vs-ciphertext leak in embedding generation, backfill logging, or the new `recall` output fields
- [ ] Re-run the 50-question calibration, then the full 500-question LongMemEval set, with both phases live. Record TWO numbers in `eval/longmemeval/README.md`'s Status section: `overall_accuracy` (labeled as harness/synthetic-reader accuracy) and `recall_at_k` (labeled as the product-reflecting retrieval-quality number)
- [ ] Any public-facing summary of results (README, PR description, Slack update) explicitly separates PRODUCT-attributable gains from EVAL-ONLY gains per the table near the top of this plan
- [ ] PR(s) opened with coverage gaps noted in description; RQ5/RQ8 tracked as follow-up once prod creds are available
