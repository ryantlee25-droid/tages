# Tages

**Persistent codebase memory for AI coding agents.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-521%20passing-brightgreen.svg)]()

Your AI agents forget everything between sessions. Tages fixes that. Conventions, decisions, architecture, past mistakes — remembered automatically, injected into every session, across every tool.

## Quick Start

```bash
npm install -g @tages/cli
tages init
```

That's it. Your AI tools now remember your codebase.

## What It Remembers

Source code tells agents **what** exists. Tages tells them **why** it was built, **how** to work with it, and **what not to do**.

| Type | Example |
|------|---------|
| **Convention** | "Always use snake_case for API routes" |
| **Decision** | "Chose Postgres over MongoDB for pg_trgm fuzzy search" |
| **Architecture** | "Auth middleware in lib/auth.ts, JWT in httpOnly cookies" |
| **Lesson** | "Don't cache the Supabase mock — tests need fresh state" |
| **Anti-pattern** | "Never pass id in upsert with onConflict — causes FK violation" |
| **Pattern** | "All API errors return { error, code, status }" |

Plus: entity, execution, operational, environment, preference (11 types total).

## How It Works

1. **Install** — `tages init` connects to your project and configures MCP
2. **Remember** — Store decisions and conventions manually, via git hooks, or by importing CLAUDE.md
3. **Recall** — Every session gets full project context in <10ms from local SQLite cache

## Works With

Claude Code, Cursor, Codex, Gemini — anything that speaks [MCP](https://modelcontextprotocol.io).

## Features

- **55 MCP tools** — remember, recall, audit, sharpen, import, federation, analytics, and more
- **35 CLI commands** — full control from the terminal
- **Web dashboard** — browse, search, and edit memories with dark-mode UI
- **Auto-indexing** — git hooks extract decisions from commits via Ollama or Claude Haiku
- **Import** — seed from existing CLAUDE.md, ARCHITECTURE.md, or JSON files
- **`tages brief`** — generate a cached context document for system prompt injection
- **`tages audit`** — score your memory coverage and get suggestions for improvement
- **`tages sharpen`** — rewrite memories into imperative form for better agent consumption
- **Local-first** — SQLite cache for sub-10ms queries, works offline
- **Hybrid search** — pg_trgm trigram matching + pgvector semantic search
- **Team sharing** — multiple developers share one codebase memory (Pro)

## Benchmarks

In three head-to-head tests, agents with Tages context scored **8.8/10 vs 7.7/10 without** — a +14% quality improvement at near-zero cost. The biggest gains were in convention compliance (+3 points) and integration correctness. Agents without memory consistently created orphaned code that didn't wire into existing subsystems.

Full methodology and raw data: [docs/benchmarks.md](docs/benchmarks.md)

## Setup Guides

- [Quickstart](docs/quickstart.md)
- [Claude Code](docs/claude-code-setup.md)
- [Cursor](docs/cursor-setup.md)
- [Codex](docs/codex-setup.md)
- [Gemini](docs/gemini-setup.md)
- [GitHub Actions](docs/github-actions.md)
- [Self-Hosting](docs/self-hosting.md)

## Architecture

```
packages/
  server/     MCP server (55 tools, stdio transport, 445 tests)
  cli/        CLI (35 commands, npm global install, 76 tests)
  shared/     TypeScript types + Supabase client
apps/
  dashboard/  Next.js 16, Supabase Auth, Tailwind, shadcn/ui
supabase/
  migrations/ 39 migrations (tables, RLS, pgvector, RBAC, encryption)
```

## Security

- **Encryption at rest** — AES-256-GCM for memory values (opt-in)
- **RBAC** — Owner/admin write, member read-only
- **Row Level Security** — All tables enforce project membership at the database layer
- **Auth** — Supabase Auth + GitHub OAuth; API tokens SHA-256 hashed with expiration
- **Secret detection** — Memories scanned for API keys, credentials, PII before storage
- **Audit logging** — Auth events, exports, and token validation tracked

See [SECURITY.md](SECURITY.md) for our full security policy and responsible disclosure process.

## Pricing

| Plan | Price | Includes |
|------|-------|----------|
| **Free** | $0 | 1 project, 10,000 memories, full MCP + CLI + dashboard |
| **Pro** | $14/mo | Unlimited projects, 50K memories, cloud sync, semantic search |
| **Team** | $29/seat/mo | 100K memories/project, federation, RBAC, SSO, analytics |
| **Self-hosted** | Free forever | Bring your own Supabase, no limits, MIT license |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)

## Named After

[Tages](https://en.wikipedia.org/wiki/Tages) — the Etruscan divine child who appeared from a furrow in the earth and dictated sacred knowledge to scribes before vanishing. The knowledge persisted long after the source was gone.
