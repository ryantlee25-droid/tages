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

## License

MIT
