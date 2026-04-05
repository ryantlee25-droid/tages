# Hacker News Launch

## Title
Show HN: Tages – Open-source persistent memory for AI coding agents (MCP)

## Body
Every AI coding session starts from scratch. The agent re-discovers your architecture, violates naming conventions, and suggests solutions you already rejected last week. I built Tages to fix this.

Tages is an MCP server that gives AI coding agents (Claude Code, Cursor, Codex, Gemini) persistent, cross-session memory about your codebase:

- **7 MCP tools**: remember, recall, forget, conventions, architecture, decisions, context
- **CLI**: `tages init` configures everything; `tages remember/recall` for manual use
- **Auto-indexing**: Git hooks extract decisions from commits using local LLM (Ollama) or Claude Haiku
- **Dashboard**: Browse, search, edit memories. Real-time updates via Supabase Realtime.
- **Local-first**: SQLite cache for sub-10ms queries. Works offline.

Stack: TypeScript monorepo (pnpm), MCP SDK, Supabase (Postgres + pg_trgm fuzzy search + Auth + RLS), Next.js 16 dashboard, better-sqlite3 for local cache.

Self-hosting is fully supported — bring your own Supabase instance, no usage limits.

Free tier: 1 project, 500 memories. Pro ($9/mo): unlimited + team sharing.

GitHub: https://github.com/ryantlee25-droid/tages

I'd appreciate feedback on the MCP tool design and what memory types would be most valuable for your workflow.
