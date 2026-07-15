# Changelog

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
