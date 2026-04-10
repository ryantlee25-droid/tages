# Tages

**Team memory for AI coding agents.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-521%20passing-brightgreen.svg)]()

Your AI agents forget everything between sessions. Every decision re-litigated. Every convention re-explained. Every past mistake repeated by the next agent that touches the same code.

Personal memory tools patch the symptom: store some facts, retrieve them later. That works for solo developers who remember what they stored. It breaks down when teams ship with AI — when three developers are using agents on the same codebase, when onboarding requires transferring institutional knowledge, when the wrong memory survives a refactor because no one audited it.

Memory isn't storage. It's a team practice.

Tages treats codebase memory as a managed artifact: structured types, quality scoring, audit trails, sharpen passes that rewrite vague notes into imperative agent instructions. One developer's architecture decision becomes every agent's context. A bad memory gets flagged and corrected before it misleads the next session.

Start in under 60 seconds with one command. Add team features when your workflow demands them.

```bash
claude mcp add tages -- npx -y @tages/server
```

## Why Tages?

| | Tages | Zep | Mem0 |
|---|---|---|---|
| Install | One line (`claude mcp add`) | Docker + API key | API key + SDK |
| Local-only mode | Yes (SQLite, zero config) | Self-hosted only | No (cloud-only) |
| Team sharing | Yes (RBAC, federation) | Yes (cloud) | No |
| Dashboard | Yes (Next.js, analytics) | Yes | Basic |
| Quality control | Audit, sharpen, enforce | No | No |
| Memory types | 11 structured types | Knowledge graph (Graphiti) | Structured |
| MCP tools | 56 | N/A | N/A |
| Search | Trigram + semantic + decay | Temporal knowledge graph | Vector |
| Workflow integration | Git hooks, CI/CD, briefs | SDK calls | SDK calls |
| Pricing | Free local / $14 Pro | Open-source / Cloud | $19-$249/mo |

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

- **56 MCP tools** — remember, recall, audit, sharpen, import, federation, analytics, and more
- **52 CLI commands** — full control from the terminal
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

In five head-to-head benchmarks, agents with Tages context scored up to **9.1/10 vs 2.8/10 without** — quality deltas scaling from +1.0 on simple tasks to +6.3 on complex ones. The biggest gains were in convention compliance, integration wiring, and gotcha avoidance. Agents without memory consistently created orphaned code that didn't wire into existing subsystems.

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
  server/     MCP server (56 tools, stdio transport, 445 tests)
  cli/        CLI (52 commands, npm global install, 76 tests)
  shared/     TypeScript types + Supabase client
apps/
  dashboard/  Next.js 16, Supabase Auth, Tailwind, shadcn/ui
supabase/
  migrations/ 42 migrations (tables, RLS, pgvector, RBAC, encryption)
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
| **Free** | $0 | Up to 2 projects, 10,000 memories, 20 core MCP tools, local SQLite |
| **Pro** | $14/mo | Up to 10 projects, 50K memories, all 56 tools, cloud sync |
| **Team** | $29/seat/mo (coming soon) | Up to 20 projects, 100K memories, federation, RBAC, SSO |
| **Self-hosted** | Free forever | Bring your own Supabase, no limits, MIT license |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)

## Named After

[Tages](https://en.wikipedia.org/wiki/Tages) — the Etruscan divine child who appeared from a furrow in the earth and dictated sacred knowledge to scribes before vanishing. The knowledge persisted long after the source was gone.
