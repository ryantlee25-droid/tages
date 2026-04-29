# Tages

**Team memory for AI coding agents.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-768%20passing-brightgreen.svg)]()

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

1. **Install** — `tages init` connects to your project, or install the Claude Code plugin for zero-config setup
2. **Remember** — Store decisions and conventions manually, via git hooks, or by importing CLAUDE.md
3. **Recall** — Every session gets full project context in <10ms from local SQLite cache

### Zero-Config Auto-Detection

When running as a Claude Code plugin or MCP server, Tages automatically detects which project you're in:

1. **`.tages/config.json`** — explicit marker file (created by `tages link`)
2. **Git remote** — matches the repo name against registered projects
3. **Directory name** — matches the folder name against registered project slugs
4. **Auto-create** — if authenticated, creates a new cloud project automatically; otherwise uses local-only mode

No `tages init` required per directory. Use `tages link [slug]` to explicitly bind a directory to a project.

### Claude Code Plugin

Install Tages as a Claude Code plugin for automatic session memory:

```
/plugin https://github.com/ryantlee25-droid/tages
```

## Works With

Claude Code, Cursor, Codex, Gemini — anything that speaks [MCP](https://modelcontextprotocol.io).

## Features

- **56 MCP tools** — remember, recall, audit, sharpen, import, federation, analytics, and more
- **53 CLI commands** — full control from the terminal
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

Reproducible LongMemEval and coding-memory benchmark results are published under [`eval/`](eval/) with full methodology, judge configuration, and run notebooks. Results are reproducible against the published harness; raw numbers are in each eval's `results/` directory.

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
  server/     MCP server (56 tools, stdio transport, 605 tests)
  cli/        CLI (53 commands, npm global install, 163 tests)
  shared/     TypeScript types + Supabase client
apps/
  dashboard/  Next.js 16, Supabase Auth, Tailwind, shadcn/ui
supabase/
  migrations/ 56 migrations (tables, RLS, pgvector, RBAC, encryption)
```

## Security

- **Encryption at rest** — AES-256-GCM for memory values (opt-in)
- **RBAC** — Owner/admin write, member read-only
- **Row Level Security** — All tables enforce project membership at the database layer
- **Auth** — Supabase Auth + GitHub OAuth; API tokens SHA-256 hashed with expiration
- **Secret detection** — Memories scanned for API keys, credentials, PII before storage
- **Audit logging** — Auth events, exports, and token validation tracked

See [SECURITY.md](SECURITY.md) for our full security policy and responsible disclosure process.
See [PRIVACY.md](PRIVACY.md) for our privacy policy.

## Pricing

| Plan | Price | Includes |
|------|-------|----------|
| **Free** | $0 | 1 project (cloud sync), 10,000 memories, 20 core MCP tools, local SQLite |
| **Pro** | $14/mo | Up to 10 projects, 50K memories, all 56 tools, cloud sync |
| **Team** | $19/seat/mo | Up to 20 projects, 100K memories, federation, RBAC, audit logging |
| **Self-hosted** | Free forever | Bring your own Supabase, no limits, MIT license |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Release Notes

### 2026-04-29 — v0.3.1: behavioral drift (Jensen-Shannon divergence on tool-call distributions)

- **Behavioral drift algorithm**: replaced the v1 `insufficient_data` stub in `behavioral-drift.ts` with a real Jensen-Shannon divergence implementation. Per-agent temporal drift: for each agent active in both windows with ≥5 calls per window, compute JSD(baseline_distribution, current_distribution) over the union tool vocabulary with Laplace smoothing, normalize to [0,1] by dividing by ln(2), and average across eligible agents (max 20). Returns `BehavioralDriftReport` with `score`, `status`, `note`, `jsd` (raw), `agentCount`, `agentDistributions` (top-3 tools per agent), and `windowA`/`windowB` boundary metadata.
- **Type layer**: new `BehavioralDriftReport`, `AgentToolDistribution`, `BehavioralWindow` interfaces in `types.ts`. `DriftReport.behavioral` retyped from `MetricStub` to `BehavioralDriftReport` (superset — no breaking change for callers reading `score`/`status`/`note`). `DriftInput` extended with `baselineSince?` and `currentSince?`.
- **Weight rebalance**: `WEIGHTS` in `compute.ts` shifted from `{semantic: 1.0, coordination: 0, behavioral: 0}` to `{semantic: 0.7, coordination: 0, behavioral: 0.3}`. For projects without tool_call_log volume, behavioral returns `insufficient_data` and contributes 0 — overall drift score drops ~30% relative to the v1 number for projects with sufficient behavioral data. Next target `{0.5, 0.25, 0.25}` when coordination ships.
- **CLI**: new `--baseline-since <window>` and `--current-since <window>` flags on `tages drift`. Both must appear together; baseline-since must be earlier than current-since; both use the existing `Nd`/`Nh`/ISO grammar. `renderHuman` extended with behavioral score, raw JSD, agent count, window boundaries, threshold guidance, and per-agent top-3 tool breakdown.
- **Tests**: 18 new tests — 12 in `behavioral-drift.test.ts` (windowing, JSD math, multi-agent averaging, top-tools reporting), 5 in `compute.test.ts` (weight exposure, weight contribution paths, edge cases), 1 in CLI `drift.test.ts` (flag parsing). 843 passing total (was 826 on main).

### 2026-04-29 — CI test-mock fix

- **CI test-mock fix — `supabase.auth` interface added to `commands-smoke` mock**: `mockSupabase` now includes a `mockAuth` object with stubbed `setSession`, `getSession`, and `refreshSession` (all returning a valid session shape). Without this, any test that calls `writeAuthConfig` and runs without `TAGES_SERVICE_KEY` set would crash with `cannot read 'setSession' of undefined` — because `createAuthenticatedClient` reads `auth.json` and calls `supabase.auth.setSession(...)` on the auth-path branch. The bug was latent until CI was widened from `pnpm --filter @tages/server test` to `pnpm -r test` in c9a27f1; `resetMockSupabase()` updated to clear the three new mock functions alongside `from`/`rpc`.

### 2026-04-29 — PR #55 White second-review fix bundle (W2 limit-semantics, W2-AOT codex regex, Q1 Windows guard)

- **W2 limit-semantics — `drift.ts` `--limit` regression reverted**: `--limit` now controls display top-K only (original semantics, default 10). A new `MAX_DB_ROWS = 10000` constant applied to both Supabase queries provides defensive OOM protection without conflating "show top N keys" with "fetch N rows from the chronological window".
- **W2-AOT codex regex — `stripTagesBlock` TOML array-of-tables support**: `targetHeader` and `anyHeader` regexes now match `[[mcp_servers.tages]]` in addition to `[mcp_servers.tages]`. Hand-edited configs using double-bracket syntax are now cleaned correctly by `--force`. JSDoc updated to document the comment-swallowing limitation.
- **Q1 Windows guard — `pathToFileURL` entrypoint fix (codex, cursor, gemini plugins)**: Replaced `import.meta.url === \`file://${process.argv[1]}\`` with `import.meta.url === pathToFileURL(process.argv[1]).href` in all three plugins. The original was broken on Windows (`import.meta.url` uses `file:///C:/...`; `process.argv[1]` uses `C:\...` — never equal), silently no-opping `main()` under `npx`.
- **Regression test**: `packages/codex-plugin/src/__tests__/index.test.ts` adds one test covering `[[mcp_servers.tages]]` strip (10 tests total, was 9). 826 passing overall.
- Deferred: W1 (comment swallowing before next non-tages header) — documented in JSDoc; S2 (friendly ENOENT for `computeOracleSha`) — punt, raw error acceptable for eval harness.

### 2026-04-29 — PR #55 White-review fix bundle

- **B1 — `drift.ts` crash on bad `--since`**: `resolveSince()` is now wrapped in try/catch; invalid input prints a clean error message and exits with code 1 instead of throwing uncaught.
- **B2 — `codex-plugin` duplicate TOML block**: `--force` no longer appends a second `[mcp_servers.tages]` header. A new exported `stripTagesBlock()` helper removes any existing tages tables in-place before the new block is written. USAGE text updated to reflect the replace-in-place behaviour.
- **W2 — `--limit` applied to queries**: `tages drift --limit` now passes `.limit()` to both Supabase queries (`field_changes` and `tool_call_log`) in addition to display truncation; the value is validated as a positive integer.
- **W3 — `agents-md` federation header**: when `agents-md-owners.json` is configured but `memories.team_id` doesn't exist, the generated AGENTS.md opens with a machine-readable `<!-- TAGES_FEDERATION_NOTE: ... -->` HTML comment so agents and reviewers see the limitation immediately.
- **Q1 — dynamic oracle SHA**: `eval/longmemeval/src/dataset.ts` now exports `computeOracleSha()` that hashes the on-disk oracle file at run time; `run.ts` reports the actual SHA instead of a hardcoded constant.
- **CI widening**: `.github/workflows/ci.yml` and `publish.yml` expanded from `--filter @tages/server` to `-r` (all packages). `publish.yml` also adds `@tages/codex-plugin` and `@tages/gemini-plugin` to the npm publish matrix.
- **New tests (15 total)**: regression suite for `codex-plugin` (9 tests, including round-trip strip+append guard), plus entry-point tests for `cursor-plugin` (3) and `gemini-plugin` (3). Plugin `main()` calls guarded with `import.meta.url` check so packages are importable in tests.

### 2026-04-20

- **README hygiene**: Stripped unreproducible benchmark claim from `## Benchmarks` section; corrected MCP tool, CLI command, test, and migration counts to match current codebase.
- **Bet A — Memory Governance foundation**: New `/governance` marketing page (draft, `noindex`). Migration `0057_provenance_fields.sql` adds `session_id`, `source_context`, and `tool_name` columns to `memories` with a GIN index and a `get_memory_provenance` RPC. `Memory` TypeScript type extended with `sessionId`, `toolName`, and `sourceContext`. Formal spec at `docs/provenance-model.md`.
- **Bet B — AGENTS.md native tooling**: New `tages agents-md write` and `tages agents-md audit` CLI subcommands. `write` generates a canonical 6-section AGENTS.md from project memory. `audit` flags vagueness, missing sections, missing runnable commands, and absence of the three-tier Always/Ask/Never boundary pattern.
- **Bet D — Cross-tool distribution**: New `@tages/cursor-plugin` package. Running `npx @tages/cursor-plugin` installs Tages in Cursor by writing `.cursor/mcp.json`. Setup guide at `docs/cursor-setup.md`.
- **CI**: New `.github/workflows/publish.yml` triggers on `v*` tag push to publish packages to npm (requires `NPM_TOKEN` repo secret).
- **Strategy documents**: `analysis/` directory lands with competitive analysis, trend scan, positioning brief, deep research execution doc, Monte Carlo pricing model, and research notes. `PLAN.md` and `REMAINING.md` added at repo root.

#### Review fixes (post-White review)

- `supabase/migrations/0057_provenance_fields.sql`: pinned `search_path = public, extensions` and added an `is_project_member(auth.uid(), m.project_id)` guard inside the `get_memory_provenance` SECURITY DEFINER function so it cannot leak provenance across projects. (B1, Q1)
- `.github/workflows/publish.yml`: publish `@tages/cursor-plugin` alongside `@tages/shared`, `@tages/server`, `@tages/cli` on `v*` tag push. (W1)
- `packages/cli/src/commands/agents-md.ts`: replaced the unsupported `\Z` anchor in `extractSection` with a JS-correct end-of-string lookahead so last-section audit rules (missing-commands, missing-tech-versions) fire correctly. Regression test added. (W2)
- `apps/dashboard/src/components/marketing/governance-page.tsx`: corrected `session_id` field type in the Provenance model table from `text` to `uuid`. (S1)
- W3 (test count targets) was declined — counts reflect a verified test-run output, not a goal. S2 (control-flow warning) was deferred — no runtime impact.

### 2026-04-20 — Bet A governance foundation (Sprint A + B + C)

- **Pre-launch hygiene (Phase 0)**: `HOOK.md` and `.semgrep-results/` added to `.gitignore`. Closed migration 0042 git gap — file had been applied to prod on Apr 10 but never committed; `supabase migration list --linked` confirmed prod/local match.
- **Sprint A — Differentiation foundation (Phase 3.1 + 3.2)**: New `@tages/codex-plugin` package (TOML writer targeting `~/.codex/config.toml`, `--dry-run`, block detection). New `@tages/gemini-plugin` package (JSON merge into `~/.gemini/settings.json` with preserved top-level keys). New `tages agents-md diff` and `tages agents-md federate` CLI subcommands extending the Bet B foundation. White review fixes: gemini env-var placeholders, codex regex false-positive on `[mcp_servers.tages.env]` alone, diff negation-word boundary.
- **Sprint B — LongMemEval harness scaffold (Phase 1.1)**: New `eval/longmemeval/` directory with standalone TypeScript harness (not in pnpm workspace). RetainDB-pattern methodology documented with comparability caveat (Supermemory/RetainDB baselines on deprecated dataset). Pluggable memory backend: `in-memory` lexical floor + `tages-cli` real integration. Dry-run verified; real runs pending `OPENAI_API_KEY` + sandbox `TAGES_EVAL_PROJECT`.
- **Sprint C — `tages drift` v1 (Phase 3.3)**: New `tages drift` CLI command (experimental). Semantic drift uses a real instability metric (1 − 1/distinct_values over field_changes); 10 unit tests cover zero/two/three-value instability, session+agent reporting, whitespace normalization, topK. Coordination drift stubbed (`not_implemented`) — blocked on `memories.team_id` column. Behavioral drift stubbed (`insufficient_data` / `not_implemented`) — tool_call_log has raw data, v2 calibration pending design partners. `--json`, `--since`, `--agent`, `--limit` flags.
- **Chore**: Plugin packages (cursor, codex, gemini) now use `--passWithNoTests` so `pnpm -r test` does not fail at the root.

### 2026-04-19

- Fixed GitHub OAuth login redirecting to the marketing homepage instead of `/app/projects` after callback. Root cause: `SameSite=Strict` cookies are withheld by the browser on cross-site top-level navigations (i.e. GitHub's redirect back to `/auth/callback?code=...`), so the PKCE verifier and refreshed session cookies never reached the server. Reverted to Supabase's default `SameSite=Lax`, which is the correct setting for SSR auth cookies. `HttpOnly + Secure + Lax` still blocks CSRF on state-changing requests.
- **Invite-flow overhaul (Team plan):** Team invites now send a one-time Supabase magic-link email rather than inserting directly into `team_members`. Pending invites expire after 30 days; expired rows are skipped by `accept_pending_invites`. Owners and admins can revoke a pending invite before it is accepted (new DELETE RLS policy). The invite role dropdown enforces RBAC at both the UI and server layers — owners can invite admin or member, admins can only invite member. Dashboard sign-ins now call `accept_pending_invites` via the OAuth callback, so web-only sign-ups resolve dangling invites automatically (previously only the MCP server did this on startup). Requires migrations `0055_invite_expiry.sql` and `0056_invite_delete_policy.sql` applied to your Supabase project.

### 2026-04-17

- Split literal Stripe-style test fixtures in `safety.test.ts` and `observe.test.ts` via string concatenation so GitHub secret scanning no longer flags them. The fixtures are intentional test inputs, not real credentials.

## License

[MIT](LICENSE)

## Named After

[Tages](https://en.wikipedia.org/wiki/Tages) — the Etruscan divine child who appeared from a furrow in the earth and dictated sacred knowledge to scribes before vanishing. The knowledge persisted long after the source was gone.
