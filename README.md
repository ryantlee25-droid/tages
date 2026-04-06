# Tages

**Persistent codebase memory for AI coding agents.**

Your agents forget everything between sessions. Tages fixes that.

Architectural decisions, naming conventions, module boundaries, past mistakes — remembered automatically, injected into every session, across every tool.

### Why Tages?

In A/B testing against a 30k+ LOC codebase, agents with Tages produced **68% higher quality documentation** with **zero hallucinations**, vs 8 fabricated systems without it. Independently validated by blind review (ChatGPT, Gemini). Neither reviewer knew which output used Tages. Both scored it significantly higher.

Cost: ~$0.003 per session. Quality improvement: measurable and proven.

---

## Works With

Claude Code, Cursor, ChatGPT, Codex, Gemini — anything that speaks MCP.

## Quick Start

```bash
npm install -g tages
tages init
```

That's it. Your AI tools now remember your codebase.

---

## What Tages Knows That Source Code Cannot

Source code tells agents **what** exists. Tages tells them **why** it was built, **how** to work with it, and **what not to do**.

| Knowledge | Without Tages | With Tages |
|-----------|--------------|------------|
| "worldGen.ts was deleted on purpose" | Never mentioned | Documented as design decision |
| "Message helpers exist because of 10 duplicates" | Described the functions | Explained the migration history |
| "Hemorrhagic shock is the ONLY combo" | Described it | Documented the design constraint |
| "CRT scanlines on inner div only" | Never mentioned | Documented with warning |
| "Stats were rebalanced from Wits" | Never mentioned | Documented the history |

---

## How It Works

1. **Install** — `tages init` connects to your project and configures MCP
2. **Remember** — Store decisions, conventions, and context manually or via git hooks
3. **Recall** — Every new session gets full project context in <10ms from local cache

## What It Tracks

| Type | Example |
|------|---------|
| **Convention** | "Always use snake_case for API routes" |
| **Decision** | "Chose Postgres over MongoDB for pg_trgm fuzzy search" |
| **Architecture** | "Auth middleware in lib/auth.ts, JWT in httpOnly cookies" |
| **Lesson** | "Don't cache the Supabase mock — tests need fresh state" |
| **Entity** | "UserProfile component in components/UserProfile.tsx" |
| **Pattern** | "All API errors return { error, code, status }" |

## Features

- **MCP Server** — 7 tools + 4 resources, works with any MCP-compatible agent
- **CLI** — `tages remember`, `tages recall`, `tages forget`, `tages import`
- **Dashboard** — Browse, search, edit, and share memories. Dark mode. Real-time updates.
- **Auto-indexing** — Git hook extracts decisions from commits using local LLM (Ollama) or Claude Haiku
- **Import** — Seed from existing CLAUDE.md, ARCHITECTURE.md, LESSONS.md files
- **Team sharing** — Multiple developers share one codebase memory (Pro)
- **Local-first** — SQLite cache for sub-10ms queries. Works offline.
- **Hybrid search** — pg_trgm trigram matching + pgvector semantic search

## Pricing

- **Free** — 1 project, 10,000 memories, full MCP server + CLI + dashboard + auto-indexing. Everything a solo dev needs.
- **Pro ($9/mo)** — Unlimited projects + memories, team sharing, cloud sync across devices.
- **Self-hosted** — Everything free forever. Bring your own Supabase.

## Evidence

Tages has been tested, not just built.

- **A/B test**: 68% quality improvement across 10 metrics on a 30k+ LOC codebase
- **Hallucination reduction**: 8 fabricated systems (cold) -> 0 (warm)
- **Blind review**: ChatGPT scored warm output 52% higher. Gemini scored it 75% higher. Neither knew which document used Tages.
- **Cost**: $0.003 per session (1,200 tokens of injected context)

Full test reports and raw outputs available in `test-ab/`.

## Architecture

```
packages/
  server/     MCP server (30 tools, stdio transport)
  cli/        CLI (29 commands, npm global install)
  shared/     TypeScript types + Supabase client
apps/
  dashboard/  Next.js 16, Supabase Auth, Tailwind, dark mode
supabase/
  migrations/ 34 migrations (tables, RLS, pgvector, RBAC, encryption)
```

## Security

- **Encryption at rest** — AES-256-GCM for memory values (opt-in via `TAGES_ENCRYPTION_KEY`)
- **RBAC** — Owner/admin can write, member read-only
- **Row Level Security** — All tables enforce project membership at the database layer
- **Auth** — Supabase Auth with GitHub OAuth; API tokens SHA-256 hashed with expiration
- **Secret detection** — Memories scanned for API keys, credentials, PII before storage
- **Audit logging** — Auth events, exports, and token validation tracked
- **Transport** — HSTS, CSP (no unsafe-eval in production), SameSite=Strict, rate limiting
- **MCP transport** — Stdio, inherently trusted by parent process. No network exposure.

## Setup Guides

- [Quickstart](docs/quickstart.md)
- [Claude Code](docs/claude-code-setup.md)
- [Cursor](docs/cursor-setup.md)
- [Codex](docs/codex-setup.md)
- [Gemini](docs/gemini-setup.md)
- [GitHub Actions](docs/github-actions.md)
- [Self-Hosting](docs/self-hosting.md)

## Development

```bash
pnpm install
pnpm build
pnpm dev          # dashboard at localhost:3000
pnpm test         # 372 vitest tests
```

## Named After

[Tages](https://en.wikipedia.org/wiki/Tages) — the Etruscan divine child who appeared from a furrow in the earth and dictated sacred knowledge to scribes before vanishing. The knowledge persisted long after the source was gone.

## Release Notes

### 2026-04-06 (auth fix)

**Critical bug fix: RLS silent failure in 22 CLI commands**

Root cause: 22 CLI commands used `createSupabaseClient` (unauthenticated anon key) instead of `createAuthenticatedClient`. With Row Level Security enabled, all queries silently returned 0 results. Commands appeared to work but returned no data — users thought their project was empty.

Fix:
- Created `packages/cli/src/config/project.ts` — shared `loadProjectConfig()` utility with try/catch for corrupt JSON (outputs friendly error instead of raw stack trace)
- Updated 21 commands to import from the shared module instead of defining duplicate functions (eliminated 25+ duplicates)
- Switched 21 commands from `createSupabaseClient` to `createAuthenticatedClient` — `init.ts` correctly kept unauthenticated since it runs before auth exists

Impact: `tages export` now returns 31 memories (was 0), `tages quality` sees all memories, all commands now respect RLS.

Changes:
- CREATE `packages/cli/src/config/project.ts` — shared loadProjectConfig utility
- MODIFY 21 command files in `packages/cli/src/commands/` — switch to createAuthenticatedClient + import shared loadProjectConfig
- MODIFY `packages/cli/src/commands/index.ts` — export loadProjectConfig from shared module

All 493 tests passing (421 server + 72 CLI).

---

### 2026-04-06

**New feature: `tages session-wrap` — end-of-session memory persistence**

Gives users a smooth path to persist codebase learnings discovered during coding sessions.

What was built:

- **Extracted session memory extraction logic** into `packages/server/src/tools/session-extract.ts` — a reusable `extractMemoriesFromSummary()` function. Updated `session-end.ts` to import from it instead of inlining.
- **New `tages session-wrap` CLI command** — two modes:
  - Interactive (default): prompts for a multi-line session summary, extracts memories by keyword, stores to Supabase + SQLite
  - Non-interactive (`--non-interactive`): reads `~/.config/tages/pending-session-notes.txt`, processes silently, deletes the file. Silent exit if no file exists (for hooks).
  - Also supports `--summary <text>` for scripted use.
- **Documentation** — added "End-of-session workflow" section to `docs/claude-code-setup.md` covering the workflow, what belongs in Tages vs local memory, manual usage, and Claude Code hook setup.

Changes:
- CREATE `packages/server/src/tools/session-extract.ts` — extracted memory extraction logic
- MODIFY `packages/server/src/tools/session-end.ts` — imports from session-extract.ts
- CREATE `packages/cli/src/commands/session-wrap.ts` — new CLI command
- MODIFY `packages/cli/src/index.ts` — register session-wrap command + import
- MODIFY `docs/claude-code-setup.md` — end-of-session workflow documentation

All 493 tests pass (421 server + 72 CLI).

---

### 2026-04-06 (earlier)

**Bug fix: upsert id-swap causes FK violation on memory_versions**

Root cause: Every upsert call across the codebase passed `id: randomUUID()` in the payload with `onConflict: 'project_id,key'`. When a key already existed, Supabase tried to overwrite the existing row's `id` with the new UUID, which violated the FK constraint from `memory_versions` (which references the old id).

Fix: Remove `id` from all upsert payloads. On insert, Postgres generates an id via `gen_random_uuid()`. On conflict, the existing row's id is preserved. Migration 0037 already cleaned up orphaned versions from past occurrences, but the root cause was never fixed until now.

Changes:
- `packages/cli/src/commands/remember.ts` — removed id from upsert
- `packages/cli/src/commands/import.ts` — removed id from upsert
- `packages/cli/src/commands/index.ts` — removed id from upsert
- `packages/cli/src/commands/snapshot.ts` — removed id from upsert (2 call sites)
- `packages/cli/src/commands/migrate.ts` — removed id from upsert
- `packages/server/src/sync/supabase-sync.ts` — strip id from memoryToDbRow before upsert (3 call sites)
- `packages/cli/src/__tests__/remember.test.ts` — updated test to assert id is NOT in upsert payload

All 493 tests passing (421 server + 72 CLI).

---

### 2026-04-06 (earlier)

**Bug fixes & recall improvements**

- Fixed `tages status` reporting 0 memories — was using unauthenticated Supabase client, now uses auth session matching `recall`, `remember`, `forget`
- Fixed `tages recall` returning incomplete results — lowered trigram similarity threshold from 0.3 → 0.15 and added ILIKE substring fallback for long values
- Added `--all` flag and `*` query alias to list all memories without filtering
- Made query argument optional when using `--all`
- Added validation: query is required unless `--all` is set
- Two new migrations: `0038_lower_recall_threshold.sql`, `0039_recall_ilike_fallback.sql` (already applied to production Supabase)
- Updated test suite for new empty-query validation

## License

MIT
