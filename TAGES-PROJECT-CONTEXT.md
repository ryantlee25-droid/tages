# Tages — Project Context for Claude

## What Tages Is

Tages is an open-source MCP server + CLI + dashboard that gives AI coding agents persistent, cross-session memory about codebases. Named after the Etruscan divine child who dictated sacred knowledge to scribes.

**Repo**: https://github.com/ryantlee25-droid/tages
**Stack**: pnpm monorepo — Node.js/TypeScript

## Architecture

```
packages/
  server/     # MCP server (stdio transport, 52 tools, 421 vitest tests)
  cli/        # tages CLI (commander.js, 32 commands, 72 tests)
  shared/     # Shared types + Supabase client factory
apps/
  dashboard/  # Next.js 16 + Supabase Auth + Tailwind + shadcn/ui
supabase/
  migrations/ # 39 Postgres migrations
```

### Storage Tiers
- **Hot**: SQLite (better-sqlite3) — local cache, sub-10ms queries, survives offline
- **Warm**: Supabase Postgres — pg_trgm fuzzy search + pgvector semantic search
- **Cold**: Archive table — stale/low-quality memories auto-archived

### Memory Types (11)
convention, decision, architecture, entity, lesson, preference, pattern, execution, operational, environment, anti_pattern

### Key Design Decisions
- SQLite-first: all reads through cache, Supabase syncs in background (60s interval)
- Supabase returns PromiseLike not Promise — wrap with `Promise.resolve()` for `.catch()`
- Zod 4 schemas on all 52 MCP tools
- TypeScript strict mode, ESM (no require)
- Sequential migration numbering (0001-0039), cast TEXT to `::uuid`
- CLI cross-package imports use `@ts-ignore` with expanded rootDir

### Security Model
- RBAC: Owner/admin write, member read-only
- RLS on all Supabase tables
- SHA-256 hashed API tokens with expiration
- Optional AES-256-GCM field-level encryption
- Secret/PII detection blocks high-severity secrets
- Audit logging on auth events

## Pricing
- Free: 1 project, 10k memories
- Pro: $9/month — unlimited projects, teams, SSO
- Self-hosted: free forever, bring your own Supabase

## Key Feature: `tages brief` (Pre-flight Context Injection)

### The Problem We Solved
Three benchmarks proved that runtime MCP calls don't improve agent code quality — the context decays in the conversation as the agent reads files and writes code. A single MCP call at session start scored 7.8/10, virtually identical to no memory (7.7/10).

### The Solution
`tages brief` generates a cached `.tages/brief.md` file that gets injected into the system prompt via `--append-system-prompt`. This keeps project context pinned at the top of every turn, scoring 8.8/10 — a +1.1 point quality improvement at zero marginal cost.

### How It Works
1. `tages brief --check` runs (via hook or manually)
2. Checks if `.tages/brief.md` is fresh (git log + age-based staleness)
3. If fresh → returns cached path instantly (0ms, $0)
4. If stale → regenerates from Supabase memories (~200ms, one query)
5. Brief injected as system prompt context

### Brief Structure (priority order)
1. **STOP — Read Before Coding**: anti_patterns and lessons as imperative rules
2. **Integration Recipes**: pattern/execution memories as step-by-step wiring guides
3. **Conventions**: coding standards with auto-highlighted code (backtick-wrapped file paths, function calls, tags, env vars)
4. **Architecture**: system overview
5. **Decisions**: rationale for key choices
6. **Remaining types**: entities, operational, environment, preferences

### Token Budgeting
Default 3000 tokens (~2k words). Sections are added in priority order until budget exhausted. Gotchas always included first.

## Benchmark Results (2026-04-06)

### Three benchmarks, three approaches tested:

| Approach | Quality | Cost vs Baseline | Key Finding |
|----------|---------|-----------------|-------------|
| Runtime MCP calls | +0.8 pts | +39% more | Haiku extraction costs $0.38/session |
| Pre-flight brief injection | +1.1 pts | +4.5% more | System prompt stays visible all session |
| Single MCP call at start | +0.1 pts | +1.5% more | **Context decays — no better than baseline** |

### The definitive test (Benchmark 3 — three-way)
Task: Build interactive pet squirrel system for a text MUD game.

| Metric | Pre-flight Brief | Single MCP Call | No Memory |
|--------|:-:|:-:|:-:|
| Quality (avg/10) | **8.8** | 7.8 | 7.7 |
| Convention compliance | **9** | 8 | 8 |
| Gotchas avoided | **9/10** | 6/10 | 5/10 |
| Combat.ts integration | **Wired** | Dead code | Dead code |
| Movement.ts integration | **Wired** | Missing | Missing |
| Rich text tags used | **Yes** | No | No |
| Shared message helpers | **Yes** | Yes | Yes |
| Cost | $2.09 | $2.03 | $2.00 |

### What memory teaches that code reading can't
Two conventions were consistently missed by agents without memory:
1. **Rich text tags** — `rt.item()`, `rt.condition()`, `rt.keyword()` exist in the codebase but agents don't know to use them in new code without being told
2. **Integration wiring points** — where exactly to hook into existing subsystems (combat.ts line ~180, movement.ts room transition handler)

### Architecture conclusion
**System prompt injection is the only delivery mechanism that works.** MCP tool results decay in context. The brief must be in the system prompt to maintain attention across a full implementation session.

## Current State (as of 2026-04-06)

### What's Built
- 52 MCP tools covering memory CRUD, analytics, quality scoring, deduplication, federation, archival, templates, impact analysis
- 32 CLI commands
- Next.js dashboard with auth, project browser, memory viewer, stats, graph visualization
- 493 vitest tests (421 server + 72 CLI), all passing
- Security hardening Groups 1-2 complete (RBAC, RLS, encryption, PII detection, audit logging)
- `tages brief` with git-based staleness detection and token budgeting
- Brief generator v2 with code highlighting, integration recipes, imperative gotcha formatting

### What's Not Built
- Task 6: Recall-to-outcome tracking (correlate recalled memories with bug-free implementations)
- Group 3 competitive differentiators (from security hardening plan)
- Hook auto-installation (`tages hook install` — deemed over-engineering, one line of config)
- Benchmark regression suite (automated re-testing of brief quality)

### Known Issues
- Brief generator can only surface what's stored — projects need pattern/execution memories for Integration Recipes section to populate
- Supabase upserts must NOT include `id` field with `onConflict` (FK violation — fixed in f436843)
- CLI binary path is `packages/cli/dist/packages/cli/src/index.js` (not `dist/index.js`) due to rootDir expansion

## Commands

```bash
pnpm install          # install all workspace deps
pnpm build            # build all packages
pnpm test             # run all 493 tests
pnpm typecheck        # tsc --noEmit across all packages

# CLI
tages init            # initialize project
tages remember <key> <value> -t <type>  # store a memory
tages recall <query>  # search memories
tages brief           # generate cached project brief
tages brief --force   # regenerate even if fresh
tages brief --check   # output file path (for hooks)
tages status          # project memory stats
tages doctor          # health check
```

## Dependencies
- `@modelcontextprotocol/sdk` v1.12.0
- `@supabase/supabase-js` v2.49.0
- `better-sqlite3` v12.8.0
- `zod` v4.3.6
- `commander` v14
- TypeScript 6, Vitest 4.1, Next.js 16
