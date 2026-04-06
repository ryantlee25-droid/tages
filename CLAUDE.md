# Tages — Project Configuration

## Overview

Tages is an open-source MCP server + CLI + dashboard that gives AI coding agents persistent, cross-session memory about codebases. Named after the Etruscan divine child who dictated sacred knowledge to scribes.

**Repo**: https://github.com/ryantlee25-droid/tages
**Stack**: pnpm monorepo — Node.js/TypeScript
**npm packages**: `tages` (CLI), `@tages/server` (MCP server), `@tages/shared` (types)

## Architecture

```
packages/
  server/     # MCP server (@modelcontextprotocol/sdk, stdio transport)
              # 30 MCP tools, 16 server modules, 30 test suites (372 tests)
  cli/        # tages CLI (commander.js, 29 commands)
  shared/     # Shared types + Supabase client factory
apps/
  dashboard/  # Next.js 16 + Supabase Auth + Tailwind + shadcn/ui
              # Auth, project list, memory browser, stats, conflicts, graph
supabase/
  migrations/ # 33 Postgres migrations (schema, RLS, RPCs, indexes)
```

### Key Design Decisions

- **Primary storage**: Supabase Postgres with pg_trgm fuzzy search + pgvector semantic search
- **Local cache**: SQLite (better-sqlite3) for sub-10ms MCP queries, 60s async sync to Supabase
- **Auth**: Supabase Auth with GitHub OAuth; CLI tokens hashed with SHA-256
- **Encryption**: Optional AES-256-GCM field-level encryption (set `TAGES_ENCRYPTION_KEY`)
- **LLM for auto-indexing**: Ollama (local) -> Claude Haiku (API) -> dumb mode (file paths only)
- **Transport**: stdio (standard for Claude Code / Cursor MCP integration)

## Security

- **RBAC**: Owner/admin can write, member read-only (migration 0031)
- **RLS**: Enabled on all tables with per-user/per-project policies
- **Token management**: SHA-256 hashed, supports expiration + `tages token rotate`
- **Encryption at rest**: AES-256-GCM for memory values (opt-in via env var)
- **Secret/PII detection**: Blocks high-severity secrets, warns on PII before storage
- **Auth audit logging**: Tracks login success/failure, token validation events
- **Transport security**: HSTS, CSP (no unsafe-eval in production), SameSite=Strict cookies
- **Input validation**: Zod schemas on all 30 MCP tools, URL slug validation, 1MB request limits
- **SECURITY.md**: Responsible disclosure policy at repo root

## Commands

```bash
pnpm install          # install all workspace deps
pnpm build            # build all packages (server + cli + dashboard)
pnpm dev              # start dashboard dev server (localhost:3000)
pnpm test             # run all tests (372 vitest tests)
pnpm typecheck        # tsc --noEmit across all packages
pnpm --filter server test  # server tests only
```

### CLI (tages)

Core: `init`, `remember`, `recall`, `forget`, `status`, `dashboard`
Advanced: `dedup`, `impact`, `risk`, `enforce`, `quality`, `templates`, `archive`, `federation`
Auth: `token rotate [--expires-in <days>]`

## Conventions

- TypeScript strict mode everywhere
- Shared types in `packages/shared/src/types.ts` — import as `@tages/shared`
- Supabase client via `createSupabaseClient()` from `@tages/shared`
- MCP tools use Zod for input validation (`packages/server/src/schemas.ts`)
- Tests with vitest (`packages/server/vitest.config.ts` excludes `dist/`)
- CLI output uses chalk for color, ora for spinners
- Supabase `.from().insert()` returns PromiseLike not Promise — wrap with `Promise.resolve()` for `.catch()`
- Cross-package CLI imports use `@ts-ignore` with expanded rootDir (`../../`)
- Migrations use sequential numbers (0001-0033), cast TEXT params to `::uuid` for uuid columns

## Current Status

All 3 weeks of the original plan are complete. Security hardening Groups 1-2 (13 tasks) shipped.
Group 3 (competitive differentiators) is planned but not started.

## Full Plan

The 3-week implementation plan + security hardening plan is at `~/.claude/projects/-Users-ryan/PLAN.md`.
