<p align="center">
  <strong style="color: #3BA3C7; font-size: 2em;">Tages</strong>
</p>

<p align="center">
  <strong>Persistent codebase memory for AI coding agents.</strong><br/>
  Your agents remember everything. Your codebase never gets re-explained.
</p>

<p align="center">
  <a href="https://dashboard-weld-nine-65.vercel.app">Live Demo</a> &middot;
  <a href="docs/quickstart.md">Quickstart</a> &middot;
  <a href="docs/self-hosting.md">Self-Host</a>
</p>

---

## The Problem

Every AI coding session starts from scratch. Your agent re-discovers the architecture, violates naming conventions, and suggests solutions you rejected last week. Context amnesia wastes hours and introduces bugs.

## The Solution

Tages is an MCP server that gives AI agents persistent memory about your codebase. Conventions, decisions, architecture, lessons learned — stored once, recalled automatically in every future session.

```bash
# Store a convention
$ tages remember "api-errors" "Return { error, code, status }" --type convention

# 3 weeks later, in a new session...
$ tages recall "error handling"
Found 1 memory (hybrid: trigram + semantic):
  [convention] api-errors
    Return { error, code, status }
```

## Results

In A/B testing against a 30k LOC game codebase:

| Metric | Without Tages | With Tages |
|--------|--------------|------------|
| Documentation quality | 4.9/10 | 8.3/10 |
| Hallucinated systems | 8 fabrications | 0 fabrications |
| Convention compliance | 17% | 100% |
| Revision cycles needed | 3-4 | 0-1 |
| Cost per session | — | $0.003 |

## Works With

Claude Code · Cursor · Codex · Gemini · ChatGPT · anything that speaks MCP

## Quick Start

```bash
npm install -g tages
tages init
```

That's it. Your AI tools now remember your codebase.

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

**14 MCP tools** — remember, recall, forget, conventions, architecture, decisions, context, observe (auto-learn), session_end (auto-extract), staleness, conflicts, stats, plus browse resources

**17 CLI commands** — init, remember, recall, forget, status, dashboard, index (git hooks), import, export, query (LLM-powered), snapshot (architecture graph), check (staleness), onboard (project briefing), patterns (cross-project library), token (CI/CD)

**Hybrid search** — pg_trgm trigram matching + pgvector semantic search via local Ollama embeddings. Queries like "status effects" find "conditions-system" even with zero keyword overlap.

**Local-first** — SQLite cache with delta sync. First session hydrates from Supabase (~500ms). Every subsequent session reads from local cache (<10ms). Works offline.

**Auto-learning** — The `observe` tool lets agents report what they're doing; Tages silently extracts memories. The `session_end` tool auto-extracts decisions and conventions from session summaries.

**Safety** — PII and secret scanner checks every memory before storage. Detects API keys, tokens, passwords, emails, SSNs. Warns but doesn't block.

**Dashboard** — Browse, search, edit memories. Cmd+K search. Decision timeline. Activity feed. Real-time updates via Supabase Realtime.

## Architecture

```
packages/
  server/     MCP server (14 tools, 5 resources, stdio transport)
  cli/        CLI (17 commands, npm global install)
  shared/     TypeScript types + Supabase client
apps/
  dashboard/  Next.js 16, Supabase Auth, Tailwind, dark mode
supabase/
  migrations/ 12 migrations (tables, RLS, pgvector, tracking)
```

## Security Model

Tages stores codebase knowledge (architecture, conventions, decisions) that may be proprietary. The security model is designed accordingly:

- **Database**: Supabase with Row Level Security (RLS) — all tables enforce project membership checks
- **Authentication**: Supabase Auth with GitHub OAuth; API tokens are SHA256-hashed before storage
- **Secret detection**: Memories are scanned for API keys, credentials, and PII before storage. High-severity secrets (AWS keys, private keys, connection strings) are **blocked by default** — use `--force` to override
- **Local cache**: SQLite files are restricted to owner-only permissions (`0600`)
- **Dashboard**: CSP headers, rate limiting on auth/API endpoints, `X-Frame-Options: DENY`
- **MCP transport**: Stdio — inherently trusted by the parent process (Claude Code, Cursor, etc). No network exposure. The trust boundary is the IDE process that spawns the server
- **Multi-tenancy**: All queries filter by `project_id`; RLS enforces ownership at the database layer

For SaaS deployments, review `supabase/migrations/0002_rls_policies.sql` and ensure your Supabase instance has RLS enabled on all tables.

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
pnpm test         # 58 vitest tests
```

## Release Notes

### 2026-04-05 (v2)
- **Advanced features**: analytics, archiving, branching, decay tracking, dedup, enforcement, federation, impact analysis, quality scoring, templates, multi-hop recall, three-way merge
- **8 new CLI commands**: dedup, impact, risk, enforce, quality, templates, archive, federation
- **16 new test suites** (362 total tests passing)
- **13 new Supabase migrations** (0018–0030)
- **Bug fixes**: archive SQLite schema, enforcement overlap threshold, CLI type safety, dashboard CommandPalette props
- **Auth audit log**: tracks login successes, failures, and token validation events with RLS

### 2026-04-05
- **7 new MCP tools**: stats-detail, memory-history, contextual-recall, resolve-conflict/list-conflicts, suggestion-engine, import, memory-graph
- **Dashboard pages**: Execution viewer, pending queue, stats dashboard, conflict resolver, memory graph
- **CLI commands**: pending, verify, import-memories, recall-context, suggest
- **Security hardening**: 10 fixes across auth, data protection, and transport
  - Open redirect fix in CLI auth route (localhost validation)
  - Stripe API: customer_id lookup instead of email; demo mode requires explicit env flag
  - CSP headers and rate limiting on auth/API endpoints
  - Cache files restricted to owner-only permissions (0600)
  - Config files restricted to owner-only permissions (0600)
  - High-severity secrets now block storage by default (with `--force` override)
  - Database: added stripe_customer_id column for safer payment lookups
  - Security model documented in README
- **Security fixes**: Cross-project conflict resolution auth, unbounded JSON.parse on import, missing project_id filter on pending queue verify/reject
- **Test coverage**: 67 new vitest tests across 7 test suites
- **Database**: 3 new migrations (memory versioning RPC, contextual recall table, conflict resolution table)

## License

MIT
