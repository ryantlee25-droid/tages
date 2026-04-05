# Tages — Project Configuration

## Overview

Tages is an open-source MCP server + CLI + dashboard that gives AI coding agents persistent, cross-session memory about codebases. Named after the Etruscan divine child who dictated sacred knowledge to scribes.

**Repo**: https://github.com/ryantlee25-droid/tages
**Stack**: pnpm monorepo — Node.js/TypeScript
**npm name**: `tages` (CLI), `@tages/server` (MCP server), `@tages/shared` (types)

## Architecture

```
packages/
  server/     # MCP server (@modelcontextprotocol/sdk, stdio transport)
  cli/        # tages CLI (commander.js)
  shared/     # Shared types + Supabase client factory
apps/
  dashboard/  # Next.js 16 + Supabase Auth + Tailwind + shadcn/ui
supabase/
  migrations/ # Postgres schema (5 tables)
```

- **Primary storage**: Supabase Postgres with pg_trgm fuzzy search
- **Local cache**: SQLite (better-sqlite3) for sub-10ms MCP queries, 60s sync to Supabase
- **Auth**: Supabase Auth with GitHub OAuth
- **LLM for auto-indexing**: Ollama (local) → Claude Haiku (API) → dumb mode (file paths only)
- **Dashboard**: Dark mode, Vercel-style sidebar, shadcn/ui components, Supabase Realtime

## Full Plan

The 3-week implementation plan is at `~/.claude/projects/-Users-ryan/PLAN.md` starting at line 1384 ("# Plan: Codebase Memory MCP Server + Dashboard"). 20 tasks across 3 weeks.

**Current status**: W1-T1 (scaffold) complete. Next: W1-T2 (Supabase schema) and W1-T3 (MCP server).

## Commands

```bash
pnpm install          # install all workspace deps
pnpm build            # build all packages
pnpm dev              # start dashboard dev server
pnpm test             # run all tests
pnpm typecheck        # tsc --noEmit across all packages
```

## Conventions

- TypeScript strict mode everywhere
- Shared types in `packages/shared/src/types.ts` — import as `@tages/shared`
- Supabase client via `createSupabaseClient()` from `@tages/shared`
- MCP tools use zod for input validation
- Tests with vitest
- CLI output uses chalk for color, ora for spinners
