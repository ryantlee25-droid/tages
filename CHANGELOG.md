# Changelog

## 2026-11-03 — `@tages/cli` 0.5.7 · `@tages/server` 0.3.6

Fixes found by new end-to-end phases 12-16 (approval queue, CLAUDE.md, recency, session longevity, onboarding smoke), written before a team rollout. See `README.md` "Release Notes" for detail.

### Approval queue
- **Approved, observed, session-extracted, and imported memories get embeddings.** They were stored without one, and the agent's cache only recalls embedded rows, so they never reached any agent's recall.
- **A read-only member can no longer "approve".** `tages verify`, `tages pending --approve-all`, `tages settings auto-save`, and MCP `verify_memory` printed success while RLS changed nothing. Every write path now checks rows affected and exits 1 (CLI) or returns an error (MCP).
- **Session summaries stay pending.** The auto-save sweep promoted `session_end` rows; it now skips the `session-extract` tag.
- **Pending and archived rows no longer appear** in `tages onboard`, `tages export`, MCP `project_brief`, or `memory://` resources.

### Freshness and retraction
- **Forgotten and archived memories leave teammates' caches.** Hydrate only upserted, so a retracted memory was served forever. It now reconciles deletions (never touching unsynced local rows), carries cloud embeddings, pages past 1,000 rows, and uses the server's `updated_at` as its watermark.
- **Agents see teammate changes within ~15 seconds.** Boot always hydrates (in the background), and `recall`, `conventions`, and `project_brief` re-hydrate when the cache is older than 15s.
- **Live rows missing an embedding are backfilled** after boot, 20 at a time.

### Recall
- **Exact matches are no longer buried.** CLI recall sorted by evidence level alone; evidence now weights the relevance score, as the server already did.
- **The newer of two identical memories wins**, and ties break on `updated_at` then `id` everywhere.

### CLAUDE.md
- **`tages export` refuses to overwrite** an existing file without `--force`, keeps Don't/Never rules, and exports live memories only.
- **`import_claude_md`** strips fenced code before splitting on headings, and `skip` checks the shared store, not just the local cache. The CLI importer reads exported anti-patterns back correctly.
- **`tages link` / `tages init`** print a clear error on an unparsable `.mcp.json` instead of a stack trace.

### Sessions
- **Every cloud command fails loudly on a dead session** (central guard in `createAuthenticatedClient`; `doctor` opts out). `remember`/`forget` keep the change locally and push after `tages login`.

## 2026-08-25 — `@tages/cli` 0.5.5 · `@tages/shared` 0.2.3

Six first-run defects found while provisioning a real team project and inviting two teammates. All six sit on the onboarding path, which is why 1,500+ unit tests missed every one. See `README.md` "Release Notes" for the full detail.

### Auth
- **`tages init` now reuses a saved session** instead of calling `runGithubOAuth()` unconditionally. It previously forced a browser round-trip even right after `tages login`, and died on a 5-minute OAuth timeout in any headless run. Falls back to the browser only when the stored session is expired, absent, or a service-key client.
- **The expiry message names `tages login`, not `tages init`.** `init` creates a project; pointing an expired user at it produced duplicate-slug failures and silent `local-<slug>` stores.
- **`tages recall` exits non-zero on an expired session.** It printed "No memories found" and exited `0`, making a dead session indistinguishable from an empty project. `createAuthenticatedClient` now reports a `SessionStatus`; `anonymous` (local-only use) still works.

### Errors
- **The free-tier cap is reported as 1 project**, the number `supabase/migrations/0002_rls_policies.sql` actually enforces. The message said 2.
- **Slug collisions are named as collisions.** A unique violation contains "violates" and fell into the plan-limit branch, telling you to upgrade over a name clash. Now points at `tages link --project-id <uuid>`.

### Indexing
- **The post-commit hook no longer invokes `npx tages`** — no such package exists on npm (404); the binary ships in `@tages/cli`. It failed silently for anyone without a global CLI install. Now prefers `tages` on PATH, falling back to `npx -y @tages/cli`.

### Docs
- `docs/quickstart.md` and `docs/team-onboarding.md` no longer tell new users npm is stale and to build from a merged release branch. Both lead with `npm install -g @tages/cli`. Corrected alongside: team seats are `LEAST(subscription_quantity, 20)` not a flat 25; the "no periodic pull" trap now separates CLI (auto-reconciles) from MCP (boot-only hydration); the stale `tages doctor` caveat is removed.


## 2026-07-14 — `@tages/cli` 0.3.0 · `@tages/server` 0.2.0 · `@tages/shared` 0.1.2

First npm release since 0.1.0 (2026-04-10). Rolls up three months of retrieval-quality, memory-correctness, and team/harness work. See `README.md` "Release Notes" for the full per-change detail.

### Retrieval quality
- **Two-stage retrieval** — Reciprocal Rank Fusion (k=60) across trigram, semantic, temporal, and per-chunk channels replacing raw-score merge; multi-vector `memory_chunks` child table + HNSW with winning-chunk citations; a date-range temporal channel; opt-in `--assembled-context` budget-fitted output. Migrations `0062`–`0064`. (LongMemEval 50q dev: overall 72%→80%, recall@k 90%→94%, temporal 38.5%→61.5%; 500q run pending as the headline number.)
- **Cross-encoder rerank is now opt-in and net-neutral.** The local ONNX model (`@huggingface/transformers`, ~90MB) is **dropped** — rerank runs only when `OPENAI_API_KEY` **and** `TAGES_OPENAI_EMBED` are set (OpenAI-judge, fail-open to fused order), on both the CLI and MCP-server paths. Off by default it fires no per-recall API call; it measured net-neutral on the eval since retrieval already surfaces the gold memory into top-k.
- **Long-input embedding silent-drop fixed** — memories over ~8192 tokens previously got no embedding (a swallowed OpenAI 400) and were invisible to semantic search; now token-aware chunked + mean-pooled, HTTP errors logged, 429s bounded so recall can't hang. Plus 3-date temporal anchoring (`referenced_date`/`relative_date`, migration `0060`) and `word_similarity()` recall widening (migration `0061`).
- **Document embeddings were never written (the #1 bug)** — `remember` never populated the pgvector column, so semantic search had been silently trigram-only since launch; now generated and synced on write (CLI and server), serialized against concurrent writes so a late upsert can't revert/resurrect a value. Ollama-primary with the OpenAI fallback made opt-in (`TAGES_OPENAI_EMBED`).

### Team + onboarding
- **`tages link --project-id <uuid>`** — an invited team member can now bind their machine to an existing shared project without ever having run `tages init` against it. Membership is enforced by the `is_project_member` SECURITY DEFINER check (fail-closed); refuses to clobber a local link pointing at a different project; routes an expired session to re-auth.

### Instrumented harness (Milestone 1)
- **`packages/harness-claude-code`** — opt-in, local-first Claude Code hook capturing tool-call events, redacting secrets before persistence, fail-closed (a broken hook never blocks an agent). CLI `tages harness enable|disable|status|sync` (per-developer opt-in). Migration `0059_harness_tool_events`. `PRIVACY.md` discloses the harness, its 90-day retention, and the marker-gated-redaction limitation. (Milestone 2 — wiring events into `tages drift` — is deferred.)

### Billing + attribution
- **Stripe billing end-to-end** — Pro and Team checkout, seat picker (1–20), webhook plan/seat sync, customer portal; plan propagation to owned `projects` rows.
- **Memory authorship + conflict attribution** — writes record `created_by`/`last_edited_by`; `get_memory_authors` RPC; conflict UI shows author names (legacy rows show "Unknown", no backfill).

### Packaging
- `@tages/cursor-plugin`, `@tages/codex-plugin`, `@tages/gemini-plugin` publish for the first time (0.1.0).
- `@huggingface/transformers` removed from `@tages/cli` and `@tages/server` dependencies (see rerank note above) — lighter `npx`/global-install footprint.

## 0.1.0 (2026-04-06)

### Features
- **Memory Quality Flywheel** — `tages audit` scores memory coverage, `tages sharpen` rewrites to imperative form, `tages session-wrap --refresh-brief` auto-invalidates cached briefs
- **Pre-flight brief injection** — `tages brief` generates a cached context document for system prompt injection with git-based staleness detection
- **Session wrap** — `tages session-wrap` extracts and persists codebase learnings from coding sessions
- **56 MCP tools** — core memory, analytics, quality scoring, deduplication, federation, archival, templates, impact analysis, convention enforcement
- **52 CLI commands** — full control from the terminal
- **Web dashboard** — Next.js 16 with Supabase Auth, project browser, memory viewer, stats, graph visualization
- **Security hardening** — RBAC, RLS on all tables, AES-256-GCM encryption, SHA-256 token hashing, PII/secret detection, audit logging

### Bug Fixes
- Fixed upsert FK violation — removed `id` from all upsert payloads (Postgres generates via `gen_random_uuid()`)
- Fixed `tages status` reporting 0 memories — switched to authenticated Supabase client
- Fixed `tages recall` incomplete results — lowered trigram threshold 0.3 to 0.15, added ILIKE fallback
- Fixed 22 CLI commands using unauthenticated client — all now use `createAuthenticatedClient()`
- Fixed Templates ESM/CJS crash — `createRequire` for CJS interop
- Fixed session-wrap period splitting on file paths

### Tests
- 521 tests total (445 server + 76 CLI), all passing
