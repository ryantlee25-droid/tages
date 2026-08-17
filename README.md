# Tages

**Team memory for AI coding agents.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1228%20passing-brightgreen.svg)]()

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
- [Team Onboarding](docs/team-onboarding.md)
- [Claude Code](docs/claude-code-setup.md)
- [Cursor](docs/cursor-setup.md)
- [Codex](docs/codex-setup.md)
- [Gemini](docs/gemini-setup.md)
- [GitHub Actions](docs/github-actions.md)
- [Self-Hosting](docs/self-hosting.md)

## Architecture

```
packages/
  server/     MCP server (56 tools, stdio transport, 818 tests: 805 passing, 13 skipped)
  cli/        CLI (45 top-level commands, npm global install, 331 tests)
  shared/     TypeScript types + Supabase client
apps/
  dashboard/  Next.js 16, Supabase Auth, Tailwind, shadcn/ui
supabase/
  migrations/ 64 migrations (tables, RLS, pgvector, RBAC, encryption)
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

### 2026-08-17 — Shutdown drain fix and CLI login permission fix (two PR #75 review blockers)

- **Shutdown dropped the entire dirty memory queue when analytics failed.** `packages/server/src/index.ts`'s drain step ran `await deps.tracker?.endSession()` then `await deps.sync?.flush()` as two sequential awaits in one async function. `endSession()` writes an analytics row and rejects on any network blip, which aborted the function before `flush()` ever ran — so every memory in the dirty queue was lost on the `exit(0)` that follows, the exact loss this block exists to prevent, over the least important thing in it. Now `Promise.allSettled` runs both regardless, logs either failure, and rethrows only a failed flush, since only that means data was left behind.
- **`tages login` could not tighten permissions on an existing `auth.json`.** `writeFileSync`'s `mode` option is the open(2) *creation* mode — applied only when the file is actually created. `login` is a re-run command by design (switch accounts, refresh an expired session), so the common case is an existing file keeping whatever bits it already had, and this file holds a live Supabase refresh token. It has been observed at `0644` on real machines. Now followed by unconditional `chmodSync(getConfigDir(), 0o700)` and `chmodSync(getAuthPath(), 0o600)`.
- Both were flagged by independent reviewers on PR #75; the shutdown fix was a merge blocker. Each has a new regression test, and both were mutation-checked: reverting the shutdown fix to sequential awaits fails "still flushes queued memories when the analytics endSession rejects"; removing the chmods fails "tightens permissions on an auth.json that already exists at 0644". Full suite after restoring both: 1,480 passing / 16 skipped across 8 packages, `pnpm typecheck` clean.
- Ships in the already-published `@tages/cli` 0.5.0 — no version bump in this commit; a follow-up release is needed to distribute the login fix.

### 2026-08-17 — Security fix: CLI login redirect could send live session tokens to any host

- **Session tokens could be redirected to any attacker-chosen host.** `apps/dashboard/src/app/auth/callback/route.ts` read the `cli_redirect` query param raw and redirected to it with `access_token`, `refresh_token`, and `user_id` attached — no host validation. An attacker could craft a provider authorize URL with `redirect_to=<site>/auth/callback?cli_redirect=https://evil.com`; the victim signs in normally and their live refresh token is delivered to the attacker. That is full account takeover, and the refresh token is long-lived. The sibling route `/auth/cli` already had the correct loopback-only guard, but `/auth/callback` never called it, and an attacker doesn't need to go through `/auth/cli` to reach the callback at all. The guard is now extracted to a shared module, `apps/dashboard/src/lib/safe-redirect.ts` (`isLocalRedirect`), and used by both routes instead of duplicated — a copy per route is how the two drifted apart in the first place. `/auth/cli`'s local copy was deleted in favor of the import; its behavior is unchanged.
- **Open redirect via the `next` param, same file.** `${origin}${next}` looks origin-locked but is not: `next=//evil.com` and `next=/\evil.com` are protocol-relative and leave the site. Now validated by the new `isSafeRelativePath`, falling back to `/app/projects`.
- **`accept_pending_invites` failures were invisible.** The call sat in a `try/catch`, but `supabase.rpc()` resolves with `{ data, error }` rather than throwing, so the catch caught nothing and a failed invite sweep logged nowhere. Now the result is destructured and `error.code`/`error.message` are logged. Still non-fatal by design — a failed invite sweep must not block the sign-in that triggered it.
- **Removed three internal audit/handoff documents from this public repository**: `FINDINGS-RELEASE-AUDIT.md`, `HANDOFF-ONBOARDING-DAY.md`, `PLAN-HOSTED-EMBEDDING.md`. Verified they contain no key material, but they document that the production `service_role` key is unrotated and world-readable, give a working privilege-escalation call against the named production deployment, name the prod project ref, and pair real user emails with `auth.users` UUIDs. `.gitignore` now blocks the whole class (`FINDINGS-*.md`, `HANDOFF-*.md`, `PLAN-*.md`, `SPLIT-*.md`). These files were public on this branch and remain in git history — removal stops further exposure but does not un-publish what was already visible.
- Verified: `isLocalRedirect`/`isSafeRelativePath` executed directly against 22 cases including `http://localhost.evil.com`, `http://127.0.0.1.evil.com`, `http://user@evil.com`, `javascript:`, `//evil.com`, and `/\evil.com` — all correctly rejected, while `http://127.0.0.1:<port>` and `http://localhost:<port>` are still accepted so the CLI login flow keeps working. `tsc --noEmit` clean, `next build` compiled successfully.

### 2026-08-17 — End-to-end suite, the `memory_versions` sync blocker (migration `0069`), and bidirectional CLI sync

- **Every edit permanently killed that user's cloud sync, silently (migration `0069`).** `memory_versions` was created in `0006` with RLS enabled and exactly one policy, `for select`; no `INSERT` policy has ever existed in any of the 69 migrations. The `snapshot_memory_version()` BEFORE UPDATE trigger on `memories` was plain `plpgsql` with no `SECURITY DEFINER`, so it ran as the invoking user and its insert was denied — and a BEFORE trigger that raises takes the whole `UPDATE` with it. Worse, the rejected row stayed dirty in the local sync queue, so every subsequent flush retried it, hit the same error, and aborted, taking brand-new unrelated memories down with it. From a user's first correction onward, nothing they wrote reached their team. Exit code stayed `0` and stdout stayed empty; only stderr carried the warning. Fixed by making the trigger `SECURITY DEFINER` with a pinned `search_path` (the pattern `0051` already uses for `check_seat_limit_on_update`) and populating `changed_by_user_id`. Safe because the function takes no caller-supplied arguments — every value comes from `OLD`/`NEW` of a row the caller was already authorized to update. Applied to prod; the end-to-end suite went from 85/109 to 115/122 on that change alone.
- **The CLI now reconciles with the cloud on its own** (`packages/cli/src/sync/auto-reconcile.ts`). Sync was previously push-only, with the local store refreshed just once at MCP server startup — so a teammate's memory was invisible until you restarted your agent. A commander `preAction` hook now pushes local changes and pulls remote state before any command that reads or writes memories. Best-effort throughout: it never changes a command's exit status or output. Rate-limited to one round trip per 60s (`TAGES_SYNC_TTL_MS`; `TAGES_NO_AUTO_SYNC=1` disables). Skips `init`, `link`, `login`, `logout`, `whoami`, `doctor`, `token`, `harness`, `dashboard`, `onboard` — `doctor` especially, since a doctor that repairs what it is diagnosing hides the bug.
- **The database is authoritative, without that meaning data loss.** Order is push-then-pull, always, and `hydrateFromRemote` now skips keys still marked dirty. Both are load-bearing: `upsertMemory(mem, false)` overwrites the value *and* clears the dirty flag, so a pull-first reconciliation would revert an unsynced local edit to the cloud's older copy and drop it from the retry queue, with no error anywhere. `hydrateFromRemote` also reports what it withheld, and `SupabaseSync.hydrate()` holds its `last_synced_at` watermark when anything was skipped — advancing past a withheld revision would push it outside every future `updated_at > lastSynced` window, so that key could never be refreshed again while the "cache is current" fast path reported it up to date forever.
- **New end-to-end suite at `e2e/`**, 126 assertions across 11 phases, driving the real CLI and the real MCP server as five separately authenticated identities with isolated `$HOME`s and their own git work repos, against real Supabase. Covers create, retrieve, update, invite/join, bidirectional sharing, roles and seat limits, cold-cache persistence, tenant isolation, retraction, and reconciliation. Phase 99 asserts the suite itself can fail. Teardown runs in a `finally` and on `SIGINT`/`SIGTERM`, then verifies zero fixture rows remain; a start-of-run sweep clears residue from any earlier run killed where teardown could not run. `node e2e/run.mjs --set-credentials` stores keys in the macOS Keychain — the `security -w` prompt cannot be used, as its `readpassphrase(3)` buffer is 128 bytes and truncates a Supabase JWT silently at exit 0.
- **Known and unfixed**, surfaced by the suite: the CLI never calls `scanForSensitiveData`, so `tages remember` persists a secret the MCP server would block (`tools/remember.ts:65`); `memories.created_by`/`updated_by` are never populated by any write path, so `get_memory_authors` returns `"Unknown"`; and recall has no relevance floor, returning top-k for nonsense queries.
- Published as `@tages/cli@0.5.1` and `@tages/server@0.3.1`. **Both are required** — the CLI carries the reconcile hook, and the server carries the `preserveDirty` guard and the watermark hold that the MCP startup hydration depends on. The other five packages are unchanged since their last release. Migration `0069` is already applied to prod, so the database half of the fix protects everyone regardless of client version.

### 2026-08-17 — Marketing site: mobile overflow, button shadow, pill rendering, nav a11y

- **Fixed horizontal overflow on every phone-width viewport.** At 390px the document laid out 523px wide, pushing the nav hamburger off-screen and running section headings off the right edge. Root cause was `min-width: auto`, the default on grid/flex children, refusing to shrink below content width — one `nowrap` command line (`tages link --project-id <project-id>`) set a width floor for the whole page. Fixed with `min-w-0` in four places: the `Command` code element and `CodePanel` root in `ui.tsx`, both grid children in `search.tsx`, and the step body in `quickstart.tsx`. Verified zero horizontal overflow across 8 routes at 5 viewport widths (360/390/430/768/1024) against a production build.
- **Removed the accent-tinted halo from the primary button's shadow**, keeping only the neutral hairline contact shadow. The fill (`signal-600` #2563eb) is identical to every other blue on the site, but the blue-tinted shadow darkened its own edge so the button read heavier than the same blue reads as text. A lighter fill (`signal-500` #3b82f6) was rejected — it gives white label text only 3.68:1 contrast, under the 4.5:1 AA floor; `signal-600` is 5.17:1.
- **Fixed the `convention` memory type rendering as bare text on `/examples`** while the other seven types rendered as pills. The tint was built by string concatenation (`` `${color}15` ``), which works for a bare hex but produced `var(--color-signal-600)15` for the one type whose color was a token, silently invalidating the background and border declarations. Replaced with `color-mix(in srgb, <color> N%, transparent)`, which works for hex and `var()` alike.
- **Mobile nav menu now locks body scroll while open, closes on Escape, and closes when the viewport crosses the 768px breakpoint** — the panel is `md:hidden`, so without that last case rotating to landscape would hide the menu while leaving the scroll lock stranded on.

Verified with `npx tsc --noEmit` (clean), `pnpm build` (clean), and a 9-check browser suite against `next start` covering scroll lock on/off, Escape, resize release, button fill, absence of the halo, 5.17:1 label contrast, and all 22 type pills painting a capsule.

### 2026-08-17 — Recall RPCs: restore service-role access, a zero-row regression from `0066` (migration `0068`)

- **`tages recall` silently returned zero rows for every query, on every project, since `0066_recall_rls_guards.sql`.** 0066 added an `auth.uid()` access guard to all four recall RPCs (`recall_memories`, `semantic_recall`, `hybrid_recall`, `chunk_semantic_recall`). All four are `SECURITY DEFINER`, so the guard is an ordinary predicate rather than RLS, and the service role does not bypass it: under `TAGES_SERVICE_KEY`, `auth.uid()` is `NULL`, both branches of the guard evaluate false, and every recall RPC returned zero rows. `tages recall --all` kept working the entire time because it is a plain PostgREST table select, which the service role does bypass RLS on — that asymmetry, identical credentials producing a full table read but zero RPC rows, was the whole bug, and it looked like a broken search index rather than an access-control regression. 0066's own header predicted this exact failure, labelled it a known behavior change, and deliberately deferred the service-role decision to a later migration; `0068` is that migration.
- **Fix adds a `service_role` exemption to the guard**, reading the role from the request-scoped JWT GUC rather than `current_user` (which under `SECURITY DEFINER` becomes the function owner and would silently exempt every caller, not just service_role). It fails closed: an absent GUC yields `NULL`, and `NULL is distinct from 'service_role'` is true, so the guard still applies to every other caller. This is not a new hole — a service-role caller can already read `memories` directly with RLS bypassed, so the exemption only restores parity between the RPC path and the table path. The case 0066 actually closed, an authenticated non-member reading another project's memories by guessing its UUID, is untouched. Everything else in all four functions carries forward from 0066 verbatim, generated by textual substitution of the guard block alone.
- Applied to dev and prod (`wezagdgpvwfywjoxztfs`) via `supabase db push --linked`; `supabase migration list --linked` confirms `0068` applied on both. Verified against prod post-deploy: `tages recall "shadow"` returns `no-accent-tinted-shadows` at 0.85 semantic similarity, and previously-dead queries ("migration", "supabase", "vercel", "how do I deploy the site", "why did mobile break") all return sensible hits.

### 2026-08-17 — CLI: `login`, `logout`, `whoami`

- **The GitHub OAuth loopback (`runGithubOAuth`) was already built and working** — it spins up a local server on `127.0.0.1`, opens the browser to the dashboard's `/auth/cli` route, and receives session tokens back — but it was only reachable from `init`, `link`, and `migrate`, each of which also creates or looks up a project and rewrites config. There was no way to sign in, sign out, or switch accounts on their own; switching identity meant hand-pasting tokens from the `/auth/cli-token` page into `~/.config/tages/auth.json`.
- **`tages login`** runs the OAuth flow and writes `~/.config/tages/auth.json` at mode `0600`, reporting the account it left and the one it landed on. **`tages logout`** removes the credentials file. **`tages whoami`** reports the signed-in identity and flags an expired access token.
- Identity is read by decoding the Supabase access token's JWT claims rather than making a network call, avoiding threading the anon key through this module to answer a question the token already answers.
- **All three warn when `TAGES_SERVICE_KEY` is set.** That env var takes precedence over `auth.json` in `createAuthenticatedClient` (`packages/cli/src/auth/session.ts:15-18`), so with it exported a successful login silently has no effect and every command keeps running as the service role. That exact trap cost a debugging session; it now announces itself.
- Verified with 10 new tests in `login.test.ts`, the full CLI suite at 473 passing across 36 files, and `tsc --noEmit` clean. Mutation-checked: neutering the service-key warning and removing the `auth.json` write each made 4 tests fail, confirming the tests assert behavior rather than just passing.
- Not yet published to npm — the shipped `@tages/cli` is 0.4.0 and does not include these commands.

### 2026-08-13 — Onboarding release: three security fixes, a working join path, a bundled CLI, and zero-install semantic search (`@tages/cli` 0.4.0 · `@tages/server` 0.3.0 · `@tages/shared` 0.2.0 · `@tages/harness-claude-code` 0.1.0 · the three editor plugins 0.1.0)

A full-repo audit against the goal "a teammate signs up, joins, and recalls a colleague's memory" found the v0.3.0 tag was never distributed and the documented onboarding path did not work end to end. This release closes that. Verified by an automated end-to-end suite driving the real CLI as three distinct authenticated identities against production: **28/28**.

- **Three security fixes, all found in this audit and applied to dev and prod (migrations `0065`-`0067`).**
  - `accept_pending_invites` was `SECURITY DEFINER`, granted to `authenticated`, and took the email and user id as **caller-supplied parameters bound to nothing**. Any signed-in user could claim anyone's pending invite and read that project's memories. Now zero-argument, deriving identity from `auth.uid()` and the JWT email claim.
  - **All four recall RPCs bypassed RLS** (`recall_memories`, `semantic_recall`, `hybrid_recall`, `chunk_semantic_recall`), filtering only on a caller-supplied `p_project_id`. The project UUID was effectively a bearer token for every memory in the project, while the documented join flow was sharing that UUID. Guarded with the same `owner OR is_project_member` pattern `0051` already applied to two other RPCs. The leak was reproduced on both databases before the fix and confirmed closed after; owner and active-member results are byte-identical.
  - **`tages team invite --role owner` had no guard**, and the RLS policy checked only the caller's role, never the role being granted, so any admin could mint an owner. Closed at the CLI and with a `BEFORE INSERT OR UPDATE` trigger, which also covers the dashboard's service-role write path.
- **The join path now works.** `tages link --project-id` previously bound a project and configured nothing. It now writes a Claude Code project-scoped `.mcp.json` (init and link both targeted **Claude Desktop's** config before this), installs the git hook, points the MCP config at the locally built server instead of the four-month-stale published package, and adds `.mcp.json` to the repo's local git excludes since it carries the project id and anon key.
- **The CLI is bundled with tsup.** `rootDir: "../../"` emitted CJS copies of sibling packages into an ESM package, so the published tarball threw `exports is not defined`. This was **not** tarball-only, as first assumed: `link.ts` loaded the emitted copy rather than the real sibling `dist/`, so the join path crashed on source installs too. Tarball is now 3 files instead of 229, and `tages templates` works from an npm install for the first time.
- **Silent failures made visible.** Both `tages remember` and the MCP `remember` tool reported success when the cloud write had failed, leaving memories local-only and invisible to teammates forever. `observe`/`verify` promoted remote rows by a local id that never matches, so promotions silently stayed `pending`. `tages doctor` reported a correct setup as broken and then advised the one command that wedges a joiner. Project resolution fell back to the alphabetically-first config, so a command run from a subdirectory could target the wrong project.
- **Housekeeping:** SIGTERM handling (MCP clients send it; only SIGINT was handled, losing embeddings on shutdown), a runnable lint for the first time (the root `lint` script had no `eslint` dependency at all), vitest no longer globs into stale worktrees, and the invite integration tests re-plumbed onto real per-user JWTs — they could never have run before, since the fixture project omitted a `NOT NULL` slug.

- **Semantic search now needs nothing installed.** Embedding used to run client-side, so every developer had to install Ollama or hold an OpenAI key — and `embedOne` probed Ollama *unconditionally*, so a teammate who happened to have it running for an unrelated project silently wrote vectors from a different model into the shared index. Similarity across models is meaningless, so those results looked confident and were noise. Embedding now runs through a hosted Supabase edge function (`gte-small`, JWT-gated, project-membership checked), and provider selection is a deterministic switch resolved once per process with no fallthrough. An unreachable endpoint degrades to trigram; it never silently switches model. All 135 existing prod memories were re-embedded onto the new provider.

### 2026-08-17 — Release: `@tages/cli` 0.5.0

Releasing `@tages/cli` 0.5.0, which packages the `login`, `logout`, and `whoami` commands added in commit `2529355` (see the entry above). No other workspace package is changing in this release.

**Known limitation (superseded):** embeddings were previously opt-in. Without Ollama or `TAGES_OPENAI_EMBED`, memories store with a null embedding and recall silently degrades to trigram matching. See `docs/team-onboarding.md`.

### 2026-07-19 — Team-readiness release (`@tages/cli` 0.3.0 · `@tages/server` 0.2.0 · `@tages/shared` 0.1.2)

First npm release since April; ships the three months of merged retrieval/harness work to users and adds the team-join path. See `CHANGELOG.md` for the rolled-up detail.

- **`tages link --project-id <uuid>`** — an invited teammate can bind their machine to an existing shared project without having created it (the gap that previously made "team memory" impossible for anyone but the project owner). Membership enforced by the `is_project_member` SECURITY DEFINER RPC (fail-closed); refuses to clobber a local link on a slug collision; expired sessions route to re-auth. New `docs/team-onboarding.md` walks the full install → auth → join → harness-opt-in path.
- **Cross-encoder rerank is now opt-in.** The local `@huggingface/transformers` ONNX model (~90MB) is dropped as a runtime dependency; rerank runs only with `OPENAI_API_KEY` + `TAGES_OPENAI_EMBED` (OpenAI-judge, fail-open), on both CLI and server, so default recall fires no per-query API call. It measured net-neutral on the eval. Lighter `npx`/global-install footprint.
- **Quality gate:** White + Gray + two high-effort `/code-review` passes on the combined diff caught 12 defects that 1,100+ passing tests and standard review cleared — silent config-clobber (data loss), an untimed CLI fetch (multi-minute hang), a server-side rerank firing on every recall, a service-role membership bypass, and an expired-session misroute among them. All fixed and re-verified READY. Final: 1,228 tests passing, typecheck clean.
- **Harness (Milestone 1)** and PRIVACY disclosure of its marker-gated redaction limitation ship for the Mersive dogfood; drift wiring (M2) is deferred.

### 2026-07-10 — Two-stage retrieval: RRF fusion, cross-encoder rerank, multi-vector chunk storage (Tier 1 + Tier 2)

- **Phase 1 (Tier 1)**: candidate-pool widening + Reciprocal Rank Fusion (k=60) replacing raw-score merge across trigram, semantic, and temporal channels (CLI merge path + SQL `hybrid_recall`, migration `0062`); local cross-encoder rerank (`Xenova/ms-marco-MiniLM-L-6-v2`, ONNX/CPU) with an OpenAI-judge fallback; new temporal date-range retrieval channel; opt-in `--assembled-context` / `assembledContext` budget-fitted output.
- **Phase 2 (Tier 2)**: new `memory_chunks` child table + HNSW index (migration `0063`); per-chunk embedding write path; `chunk_semantic_recall` RPC returning winning-chunk citations (migration `0064`); chunk channel wired in as a 4th RRF list; single-project backfill script for existing memories.
- **Measured results (LongMemEval 50q, seed 42, dev project)** vs. the pre-Phase-1/2 baseline (migration 0061): overall accuracy 72%→80% (+8), recall@k 90%→94% (+4), temporal-reasoning 38.5%→61.5% (+23), single-session-preference 33%→67% (+34), zero-hit questions 5/50→3/50. All targets from the plan's recalibrated expectations were met. The gains come from the chunk + temporal channels; the cross-encoder rerank is net-neutral on this 50q sample since retrieval already surfaces the gold memory into top-k (consistent with the reader-is-the-bottleneck finding). A 500q run is pending as the headline number.
- **Quality gate**: White + Gray + a high-effort `/code-review` pass on the combined diff found 10 confirmed defects that 1,191 passing tests and a medium review both cleared — all fixed and White-re-verified (0 blockers). Notable catches: the cross-encoder rerank was a silent no-op (text-classification pipeline saturated every score to 1.0; fixed to raw logits); an embedding-space mismatch between OpenAI-only chunks and Ollama-first queries; unencrypted `chunk_text` defeating at-rest encryption; the reranker scoring ciphertext; a flush/write concurrency clobber of dirty flags; and chunk sync keyed on local ids that never match remote (would have shipped Phase 2 as a silent no-op).
- **Reviewer decision (resolved)**: the local `@huggingface/transformers` cross-encoder (ONNX, ~90MB model cached on first use) that this phase originally added to CLI + server has since been dropped as a runtime dependency; cross-encoder rerank is now opt-in and requires `OPENAI_API_KEY` + `TAGES_OPENAI_EMBED` rather than shipping a bundled local model. Migrations `0062`–`0064` are now applied to prod (prod is current through `0064`).
- **Known scope boundaries**: MCP rerank only fires on the remote-hybrid fallback path (warm local cache returns early); temporal channel only helps regex-resolvable dates and its nearest-date guarantee is heuristic above ~1000 date-carrying memories/project; a pre-existing transient double-insert window on concurrent chunk writes self-heals (follow-up: route through the flush mutex or add a `(memory_id, chunk_index)` unique constraint). Phase 3 (ingestion-time observation distillation + knowledge-update supersedence relations) is deferred, not in this change.

### 2026-07-10 (precision + recall)
- **Reader temporal fix + recall widening.** The eval reader now receives the question's reference date: temporal-reasoning +15.4pt, knowledge-update +25pt, overall 54%→62% on the 50q LongMemEval calibration (mechanism row-verified: "28 weeks ago"→"2 weeks ago"). Added `word_similarity()` to `recall_memories`/`hybrid_recall` (migration 0061) to recover long-single-session recall dilution. CLI recall: surfaces referenced/relative dates, tunable `TAGES_RECALL_THRESHOLD` (clamped [0,1]), conservative content dedup. Migration 0061 validated on dev; recall-lift measurement + prod apply pending.

### 2026-07-10
- **fix(cli): one-shot `tages remember` now generates + persists a durable embedding.** The CLI write path never embedded (only the long-lived MCP server did via fire-and-forget), so CLI-stored memories were invisible to semantic search (trigram-only). Also fixed: embedding was dropped on re-remember of an existing key (id vs project_id+key mismatch), and dropped in sync because rowToMemory never reconstructed it.


### 2026-07-09 — Long-input embedding fix + 3-date temporal anchoring (Tier-1 retrieval quality)

- **Embedding silent-drop fix (Tasks A+B)**: memories over ~8192 tokens got NO embedding at all — OpenAI's 400 was swallowed, so the memory was invisible to semantic search with no error surfaced. `generateEmbedding()` (new `chunking.ts` in both `packages/cli` and `packages/server`) now token-aware chunks long input and mean-pools the resulting vectors; HTTP error bodies are logged instead of discarded; 429s are retried with a fresh per-attempt timeout and total backoff capped at 2s so the recall read path can't hang.
- **Temporal 3-date anchoring (Task C)**: new `referenced_date`/`relative_date` columns (migration `0060_temporal_date_anchoring`, drops and recreates `hybrid_recall`/`semantic_recall` to return them with every original clause preserved verbatim), a rule-based date extractor, a narrowed temporal-query classifier, and relevance-preserving date-proximity reordering in recall. Targets temporal reasoning, the universal weak spot (23–54%) across every LongMemEval run to date.
- **Quality gate**: 1,089 tests passing, typecheck clean. White (Opus) review + Gray + a high-effort `/code-review` workflow pass; the workflow caught real blockers White/Gray missed (temporal reorder was discarding relevance, the classifier over-fired on "may"/"after", and the retry hardening had re-introduced the silent-drop and could hang recall) — all fixed and adversarially re-verified READY.
- **Must-do before prod**: migration `0060` is SQL and not exercised by the test suite — apply it against a Supabase dev branch and confirm `hybrid_recall`/`semantic_recall` return the new columns and existing recall still works before it reaches prod.
- **Follow-ups (non-blocking)**: classifier still misses bare relative phrases like "last week"/"last month" (pre-existing, not a regression); previously-silently-dropped long memories need a manual per-project embedding backfill via `packages/server/scripts/backfill-embeddings.ts`; the CLI's `remember` command still never generates embeddings at all (separate gap, out of scope here, needs its own ticket).

### 2026-07-09 — Instrumented Claude Code hook capture for behavioral drift (Milestone 1)

- **New `packages/harness-claude-code` capture package**: an opt-in, local-first Claude Code hook (bin) that parses stdin tool-call events, redacts secrets, and appends them to a local SQLite log. Fail-closed by design — any parse/write error is swallowed and the process still exits 0, so a broken hook can never block or crash an agent's tool call. Additive to the existing MCP path; ships ahead of a Mersive engineering team dogfooding it for a baseline data window.
- **Secret redaction extracted to `@tages/shared`**: new `redactSensitiveData` helper, shared between the MCP server's existing `safety.ts` and the new hook capture package, redacting before persistence rather than after.
- **Migration `0059_harness_tool_events`**: new table for captured tool-call events; RLS policies copied verbatim from `tool_call_log` (both the owner and `team_members` branches) to avoid the RLS-drift class of bug.
- **CLI `tages harness enable|disable|status|sync`**: per-developer opt-in. `enable` writes an absolute-path hook entry into the developer's gitignored `.claude/settings.local.json` (never into shared repo config); `sync` batch-uploads redacted rows to Supabase.
- **`PRIVACY.md`** amended to disclose the opt-in harness and its 90-day retention window.
- **Quality gate**: 971 tests passing, typecheck clean across all 9 packages. A high-effort review plus 3 adversarial review rounds found and fixed 8 defects, including 3 distinct secret/PII redaction leaks (nested-object, numeric, and argv-split forms), a silent-no-op hook path, and a slug-misroute regression. A subprocess smoke test confirmed end-to-end capture + redaction against the real compiled bin.
- **Coverage warnings (non-blocking)**: `harness.ts` ~76% line coverage, `packages/harness-claude-code/src/index.ts` ~90% — flagged for follow-up, not a merge blocker.
- **Deferred to Milestone 2 / follow-up**: `harness sync` is currently at-least-once (needs a dedup/unique constraint or upsert on `harness_tool_events`); redaction is still marker-gated regex (brittle — a bare secret with no adjacent marker is indistinguishable from a SHA/base64, worth an entropy-based or structural deny-by-default pass); `harness_tool_events` still needs to be merged into the drift computation in `drift.ts`; and the server's `embeddings.ts` OpenAI fallback (pre-existing, from PR #65) should be gated behind an env flag the same way the CLI already is.

### 2026-07-09 — LongMemEval-driven memory-quality fixes (product + eval harness)

- **Product fix: document embeddings were never written (the #1 bug)** — `remember` never populated the pgvector `embedding` column, so semantic recall had been silently trigram-only since it shipped. `packages/server/src/tools/remember.ts` and `packages/server/src/embeddings.ts` now generate and persist the embedding on write; `packages/server/src/sync/supabase-sync.ts` syncs it to Supabase narrowly, serialized against concurrent writes/deletes so a late embedding upsert can no longer revert a newer value, resurrect a `forget`-ed memory, or strand a dirty flag.
- **CLI/server embedding parity**: `packages/cli/src/lib/embedding.ts` and `packages/cli/src/commands/recall.ts` gain the same Ollama-primary embedding path the server uses, with the OpenAI fallback made opt-in (`TAGES_OPENAI_EMBED`) rather than a blocking, billable per-recall call — closes both the hot-path cost/latency issue and the Ollama(768-dim)/OpenAI(1536-dim) vector-space mismatch.
- **Structured, citable recall output**: `packages/server/src/tools/recall.ts` reshapes passages for the client-agent reader (source, updated-at citation, formatted body), and now guards against undefined `updatedAt`/`source` on legacy/backfilled rows instead of throwing.
- **Migration 0058 DDL fix**: `supabase/migrations/0058_drop_provenance_user_id.sql` switched from `CREATE OR REPLACE` to `DROP` + `CREATE` so the function signature change actually applies.
- **Embedding backfill script**: `packages/server/scripts/backfill-embeddings.ts` — sandbox-scoped, one-time backfill for memories written before the embedding-on-write fix.
- **Truncate-renormalize guard**: `normalizeTo1536` now renormalizes after truncating embeddings over 1536 dims, so an over-1536-dim future embedding can't silently corrupt cosine-similarity rankings.
- **Eval harness (Phase 1, EVAL-ONLY)**: per-type judge, type-aware answer prompt, retrieved-memory logging, a real `recall@k` retrieval metric, turn-level ingest, a Chain-of-Note reader, and a correction to `eval/longmemeval/README.md`.
- **Validation**: 918 tests passing (669 server + 204 CLI + 45 eval), monorepo typecheck clean. Quality gate ran White + Gray + a high-effort `/code-review`; the high-effort pass caught 6 concurrency/correctness blockers (embedding-sync races, a recall crash on null dates, CLI blocking-paid-embed cost, vector-space mismatch) — all fixed and re-verified READY before this PR.

### 2026-07-08 — LongMemEval eval-backend expansion + memory-quality fix plan

- **Pluggable LongMemEval embedder backends**: `eval/longmemeval/src/memory.ts` gains three new `Backend` variants — `tages-semantic` (nomic/pgvector via Tages' own semantic store, `semantic-store.ts`), `openai-cosine` (OpenAI embeddings + cosine similarity, `openai-store.ts`), and `voyage-cosine` (Voyage AI embeddings, `voyage-store.ts`) — alongside the existing `tages-cli` and `in-memory` backends. Also fixes the `tages remember` memory type passed by `TagesCliStore` from `fact` to `entity`.
- **Benchmark results captured**: nine result JSONs from tonight's runs across all backends (baseline in-memory, Tages local/cloud-dev/semantic v1+v2, OpenAI small/large, Voyage 4-large/code-3) landed in `eval/longmemeval/results/`.
- **Memory-quality fix plan**: `PLAN-MEMORY-FIXES.md` lays out a two-phase plan — Phase 1 (EVAL-ONLY) fixes the harness's judge/prompting/ingestion issues; Phase 2 (PRODUCT) fixes the real bug found during this run: the pgvector `embedding` column is never populated on the `remember` write path, so semantic search has been silently trigram-only since it shipped. This commit is the base Phase 1 builds on.

### 2026-04-29 — Week 1 housekeeping (governance unghost, action-setup v6, drop provenance user_id)

- **A1 — Governance page indexed**: removed `robots: 'noindex, nofollow'` from `/governance` metadata. The page is now crawlable and eligible for Google Search Console indexing. Added `/governance` link to both the desktop nav (after Security, before GitHub) and the mobile menu using the same styling as adjacent links.
- **A4 follow-up — publish.yml pnpm/action-setup aligned to v6**: bumped `pnpm/action-setup@v5` to `@v6` in `.github/workflows/publish.yml`. PR #31 (Dependabot) is bringing `ci.yml` to v6; without this bump `publish.yml` would be left on v5 — functional but inconsistent and easy to forget before the v0.3.1 tag push.
- **B1 — `get_memory_provenance` no longer returns raw auth.users UUID (migration 0058)**: `create or replace function` in `supabase/migrations/0058_drop_provenance_user_id.sql` removes the `user_id uuid` column from the function's `returns table(...)` and the corresponding `m.updated_by as user_id` from the SELECT. All other columns retained. The function still returns `user_display` (full_name → email-prefix → "Unknown") which is sufficient for every caller. Zero callers in the codebase (`grep -r get_memory_provenance apps/ packages/` returns no hits). Closes White W1 review finding from PR #55. Migration must be applied to prod via `supabase db push --linked` after merge.

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
