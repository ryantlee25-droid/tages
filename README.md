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

### 2026-04-06

**Bug fixes & recall improvements**

- Fixed `tages status` reporting 0 memories — was using unauthenticated Supabase client, now uses auth session matching `recall`, `remember`, `forget`
- Fixed `tages recall` returning incomplete results — lowered trigram similarity threshold from 0.3 → 0.15 and added ILIKE substring fallback for long values
- Added `--all` flag and `*` query alias to list all memories without filtering
- Made query argument optional when using `--all`
- Added validation: query is required unless `--all` is set
- Two new migrations: `0038_lower_recall_threshold.sql`, `0039_recall_ilike_fallback.sql` (already applied to production Supabase)
- Updated test suite for new empty-query validation

All 493 tests passing (421 server + 72 CLI).

## License

MIT
