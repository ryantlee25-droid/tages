# Tages

**Persistent codebase memory for AI coding agents.**

Your agents remember everything. Your codebase never gets re-explained.

---

Tages is an open-source MCP server that gives AI coding agents persistent, cross-session memory about your codebase. Architectural decisions, naming conventions, module boundaries, past mistakes — remembered automatically, injected into every session, across every tool.

Named after [Tages](https://en.wikipedia.org/wiki/Tages), the Etruscan divine child who emerged from a plowed field and dictated all sacred knowledge to scribes before disappearing. Knowledge that surfaces from the ground, gets recorded, and persists.

## Works With

- Claude Code
- Cursor
- ChatGPT
- Codex
- Gemini
- Anything that speaks MCP

## Quick Start

```bash
npm install -g tages
tages init
```

That's it. Your AI tools now remember your codebase.

## How It Works

1. **Install** — `tages init` connects to your project and configures your AI tools
2. **Remember** — Agents store decisions, conventions, and context as they work. Git hooks auto-extract from commits.
3. **Recall** — Every new session starts with full project context. No re-explanation needed.

## CLI Commands

```bash
tages init              # Initialize for current project (GitHub OAuth)
tages init --local      # Local-only mode (no cloud sync)
tages remember <key> <value> --type convention  # Store a memory
tages recall <query>    # Fuzzy search memories
tages forget <key>      # Delete a memory
tages status            # Show memory counts and sync status
tages dashboard         # Open web dashboard
```

## MCP Tools

The MCP server exposes 7 tools to AI agents:

| Tool | Description |
|------|-------------|
| `remember` | Store a memory (convention, decision, architecture, etc.) |
| `recall` | Fuzzy search memories by query |
| `forget` | Delete a memory by key |
| `conventions` | List all coding conventions |
| `architecture` | List architecture notes |
| `decisions` | List the decision log |
| `context` | Get memories related to a file path |

Plus 4 resources: `memory://project/{id}/conventions`, `architecture`, `decisions`, `entities`.

## Setup Guides

- [Quickstart](docs/quickstart.md)
- [Claude Code](docs/claude-code-setup.md)
- [Cursor](docs/cursor-setup.md)
- [Codex](docs/codex-setup.md)
- [Gemini](docs/gemini-setup.md)
- [GitHub Actions](docs/github-actions.md)
- [Self-Hosting](docs/self-hosting.md)

## Features

- **MCP Server** — 7 tools + 4 resources, works with any MCP-compatible agent
- **CLI** — `tages remember`, `tages recall`, `tages query`, `tages import`
- **Dashboard** — Browse, search, edit memories. Dark mode. Real-time updates.
- **Auto-indexing** — Git hook extracts decisions from commits using local LLM (Ollama) or Claude Haiku
- **Import** — Seed from existing CLAUDE.md, ARCHITECTURE.md, LESSONS.md files
- **Team sharing** — Multiple developers share one codebase memory (Pro)
- **Local-first** — SQLite cache for sub-10ms queries. Works offline.

## Pricing

- **Free** — 1 project, 500 memories, MCP server + CLI (open source, always free)
- **Pro ($9/mo)** — Unlimited projects + memories, team sharing, auto-indexing
- **Self-hosted** — Everything free forever, bring your own Supabase

## Architecture

```
packages/
  server/     # MCP server (Node.js, @modelcontextprotocol/sdk)
  cli/        # tages CLI (commander.js, npm global install)
  shared/     # Shared TypeScript types + Supabase client
apps/
  dashboard/  # Next.js 16 + Supabase + Tailwind + shadcn/ui
supabase/
  migrations/ # Postgres schema
```

## Development

```bash
pnpm install
pnpm build
pnpm dev        # starts dashboard
```

## Environment Variables

For the dashboard (`apps/dashboard/.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

For the CLI / MCP server (set via `tages init` or env):
```
TAGES_SUPABASE_URL=your-supabase-url
TAGES_SUPABASE_ANON_KEY=your-supabase-anon-key
TAGES_PROJECT_ID=your-project-id
```

For Stripe (dashboard only):
```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Contributing

PRs welcome! See [PUBLISHING.md](PUBLISHING.md) for release process.

```bash
git clone https://github.com/ryantlee25-droid/tages.git
cd tages
pnpm install
pnpm build
pnpm dev
```

## Release Notes

### 2026-04-04 — Week 3: Launch Prep
- Landing page with hero, problem, how-it-works, pricing sections
- Pro tier: team sharing, settings page, upgrade flow
- Stripe integration: checkout, webhooks, billing portal
- GitHub Actions auto-indexer with API token auth
- npm publish prep (`files`, `prepublishOnly`)
- OG image, robots.txt, sitemap, SEO
- Product Hunt + HN launch drafts
- Self-hosting guide

### 2026-04-04 — Week 2: Intelligence
- Git hook auto-indexer (Ollama → Claude Haiku → dumb fallback)
- File importers (claude-md, architecture-md, lessons-md)
- `tages query` with LLM-powered answers
- Cmd+K search, decision timeline, activity feed
- Multi-provider setup guides (Cursor, Codex, Gemini)

### 2026-04-04 — Week 1: Foundation
- Monorepo scaffold (pnpm workspaces, TypeScript strict)
- Supabase schema: 5 tables, RLS policies, pg_trgm fuzzy search
- MCP server: 7 tools + 4 resources, stdio transport, SQLite cache
- CLI: `init`, `remember`, `recall`, `forget`, `status`, `dashboard`
- Dashboard: GitHub OAuth, project list, memory browser with real-time updates
- Local-only mode for offline/self-hosted usage

## License

MIT
