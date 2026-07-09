# Plan: Instrumented Harness (Claude Code Hooks Ingestion)
_Created: 2026-07-08 | Type: New Feature_

## Goal
A developer running Claude Code on a Tages project can opt in to a second, local-first ingestion path that captures the agent's full tool-call stream (Read/Edit/Bash/Grep/MCP/etc.) via Claude Code hooks, redacts secrets before anything is persisted, batch-syncs to a new Supabase table, and — in the second shippable milestone — feeds that richer stream into `computeBehavioralDrift` alongside the existing (MCP-only) `tool_call_log` data.

## Background

Tages' behavioral drift metric (`packages/server/src/drift/behavioral-drift.ts`) computes Jensen-Shannon divergence over per-agent tool-call distributions read from `tool_call_log` (`supabase/migrations/0030_analytics.sql`). Because Tages is itself only an MCP server, this can only ever reflect calls to Tages' own 56 tools — it is blind to Bash, Read, Edit, and every other action a coding agent actually takes. The goal of this plan is to add a harness that sees the real stream, without replacing or destabilizing the MCP path.

**Verified findings from reading the code (Step 1) that change the plan:**

1. **The MCP write path into `tool_call_log` does not currently exist.** `packages/cli/src/commands/drift.ts:164` reads from `tool_call_log`, but a repo-wide grep for inserts into that table returns zero hits outside that read and stale `dist/` type declarations. `packages/server/src/analytics/session-recorder.ts` defines `SessionRecorder.recordToolCall()`, but it is never called from `packages/server/src/index.ts` — only `startSession`/`endSession` are wired (line 213, 379, 818), and those write to `agent_sessions` via the separate `SessionTracker` class (`packages/server/src/tracking.ts`), not to `tool_call_log`. **In production today, behavioral drift always returns `insufficient_data`** — this was already partially flagged as a risk in `BEHAVIORAL_DRIFT_PLAN.md` (OQ-3, "tool_call_log might be empty"), but the actual state is stronger than "might be sparse": it is currently never written to at all. This is scoped as an optional stretch task (Task 6), not required for this plan's milestones, since it's a pre-existing gap outside the requested work — flagged for Ryan's call in Open Questions.
2. **`PRIVACY.md` currently states, as a public commitment, that Tages does NOT collect "Your IDE or editor activity."** This instrumented harness is exactly that. `PRIVACY.md` must be amended as part of this plan (Task 4), not as a follow-up — shipping the harness while that sentence is still live is a direct contradiction of a public policy document.
3. **No Claude Code hooks integration exists anywhere in this repo today.** `.claude-plugin/plugin.json` declares only `mcpServers` and `skills`; there is no `hooks` key, no precedent to extend. This is greenfield within Tages, though Claude Code's hook protocol itself (PreToolUse/PostToolUse/SessionEnd/Stop hooks receiving JSON on stdin) is an external, stable contract — flagged as an assumption in Open Questions since it's inferred from general Claude Code knowledge, not verified against this repo.
4. **`behavioral-drift.ts` is source-agnostic.** It consumes `ToolCallRow[]` (`project_id, session_id, agent_name, tool_name, created_at`) and has no knowledge of `tool_call_log` as a table. This means a new, richer table can be merged into drift computation with zero changes to `packages/server/src/drift/*` — only the CLI's data-fetch step (`packages/cli/src/commands/drift.ts`) needs to also query the new table and concatenate, projected down to `ToolCallRow`. This directly shapes the schema recommendation below.
5. **Reusable secret scanner**: `packages/server/src/tools/safety.ts` exports `scanForSensitiveData()`, `hasHighSeverity()`, `formatSafetyWarnings()` — currently *warn*, not *redact* (`remember.ts` blocks storage on high-severity but never strips the value). The harness needs actual redaction (replace matched spans, not just flag), so this logic needs a small addition, not just reuse as-is.
6. **Local-first precedent**: `packages/server/src/cache/query-log.ts` is the closest structural match for a new local capture log — plain `better-sqlite3` + WAL mode + a single append-only table, no ORM. `packages/cli/src/sync/cli-sync.ts` is the precedent for CLI-side batch flushing to Supabase (local cache → 60s async sync, per `CLAUDE.md`'s stated design).
7. **Migration numbering**: latest is `0058_drop_provenance_user_id.sql`. Next is `0059`, matching the user's instruction.

## Scope

**In scope:**
- New Claude Code hook capture package, local SQLite log, secret redaction, opt-in enable/disable CLI command, batch sync to a new Supabase table, and (milestone 2) merging that data into the existing `computeDrift`/`computeBehavioralDrift` pipeline.
- Privacy policy amendment and consent copy for the new capture path.
- Architecture that lets Cursor/Codex/Gemini harnesses be added later as sibling packages without touching this plan's schema or sync command signature.

**Out of scope (this plan):**
- Building Cursor, Codex, or Gemini hook capture — only the extension points are architected, not implemented.
- Dashboard visualization of harness data (apps/dashboard is untouched).
- Verbose/raw local capture mode (uncapped file contents, full diffs) — v1 captures tool name, scrubbed args/paths, exit codes, durations, timestamps only.
- Fixing the pre-existing dark MCP→`tool_call_log` write path (Finding 1) — offered only as optional Task 6, gated on an Open Question.
- Any change to `computeBehavioralDrift`'s JSD math itself — Finding 4 means none is needed.

**Ambiguities resolved (defaults applied, not blocking):**
- New package is named `packages/harness-claude-code/` (not `claude-code-plugin`) since, unlike `cursor-plugin`/`codex-plugin`/`gemini-plugin` (one-shot MCP config installers), this package ships an always-on capture binary invoked per tool call.
- `tages harness enable` writes the hooks block to `.claude/settings.local.json` by default, not the shared `.claude/settings.json` — this repo's own `.claude/settings.local.json` (gitignored, personal) is the existing convention for personal, non-team-forced configuration, and hook-based behavioral capture is exactly the kind of thing that should default to personal opt-in rather than being silently forced on every teammate via a committed file.
- No new `projects` table column for a capture-enabled flag — installing the hook locally *is* the opt-in signal for v1; simpler than adding server-side state that could drift from the local reality.

## Type Dependencies

- `ToolCallRow` in `packages/server/src/drift/types.ts` — the common shape both `tool_call_log` and the new `harness_tool_events` table must project down to. Used by Task 5.
- New `HarnessEvent` type (to be added to `packages/shared/src/types.ts`) — the normalized cross-harness event shape produced by Task 2b and consumed by Task 3's sync command. This is the extension point for future Cursor/Codex/Gemini harnesses: each would produce `HarnessEvent[]`, none would need a new sync command or schema.
- `SafetyWarning` in `packages/server/src/tools/safety.ts` — being relocated to `packages/shared/src/safety.ts` in Task 2a; both `packages/server/src/tools/remember.ts` (existing consumer) and `packages/harness-claude-code` (new consumer) depend on it post-move.

## Technical Approach

- **Schema**: new table `harness_tool_events` (migration `0059`), not an extension of `tool_call_log`. Reasoning (Decision 2, flagged below): mixing sources into one table risks an accidental schema/RLS regression on the table the (currently dark, Finding 1) MCP path is meant to use, for no benefit — `behavioral-drift.ts` only needs `ToolCallRow` projections (Finding 4), so two source tables merged at query time in `drift.ts` is strictly simpler and zero-risk to the existing table.
- **Capture mechanism**: Claude Code hooks (PreToolUse, PostToolUse, SessionEnd, Stop) invoke a small Node bin (`packages/harness-claude-code`) that reads the hook's JSON payload from stdin, normalizes it to `HarnessEvent`, redacts secrets via `@tages/shared`'s scanner, and appends to a local SQLite log (mirrors `query-log.ts`'s pattern).
- **Transport**: local batch upload, not per-call (Decision 3, flagged below). Hooks run synchronously in the agent's turn — a network call per tool invocation adds latency to every Read/Edit/Bash the agent does. A local SQLite append is sub-millisecond (precedent: `query-log.ts`). `tages harness sync` (or a timer/SessionEnd-triggered flush) batches unsynced local rows into one Supabase insert, matching the existing local-cache-then-async-sync design already stated in `CLAUDE.md`.
- **Privacy/opt-in**: per-developer, explicit (Decision 4, flagged below). `tages harness enable` requires an existing cloud project config, prints what will be captured/redacted/retained, and requires confirmation before writing `.claude/settings.local.json`. Raw, unredacted content never leaves the machine — only the redacted record is ever written to the local log or synced.
- **MCP stays as-is.** No task in this plan modifies MCP tool registration or the 56-tool surface (Task 6, if approved, is the only near-touch, and it's optional).

## Milestone Sequencing (MVP before rollout is the priority)

Ryan's Mersive engineering team starts next week; baseline behavioral data from day one is non-recoverable if missed. **Milestone 1 is the minimal cut that must ship before rollout.** Milestone 2 (drift wiring) can land any time after — it only changes how already-captured data is read, so no baseline data is lost by shipping it later.

**Milestone 1 — Capture starts (ship before rollout): Tasks 1, 2a, 2b, 3, 4**
**Milestone 2 — Drift wiring (post-rollout follow-up): Task 5**
**Optional / not on either milestone's critical path: Task 6**

## Tasks

- [ ] **Task 1 — Supabase migration: `harness_tool_events`** — New table capturing the richer stream: `project_id, session_id, agent_name, source TEXT` (e.g. `'claude_code_hook'`, future-proofs for `'cursor_hook'` etc.), `tool_name, event_type TEXT` (`'pre'|'post'`), `exit_code INTEGER, file_path TEXT, duration_ms INTEGER, args_scrubbed JSONB, result_summary TEXT, secrets_redacted_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ`. RLS policy copied verbatim from `tool_call_log`'s `USING (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid() UNION SELECT project_id FROM team_members WHERE user_id = auth.uid()))` clause in `0030_analytics.sql` — do not reimplement via a helper function (see Notes).
  - Files: Creates `supabase/migrations/0059_harness_tool_events.sql`
  - Tests: migration applies cleanly (`supabase db reset` or linked apply); manual RLS smoke test as two different simulated users (documented psql steps in the migration's own comment header, since the repo has no automated pgTAP/RLS test harness) confirming cross-project isolation, matching the "smoke-test as real user" lesson from the 0051 RBAC hardening regression.
  - Depends on: none
  - Effort: M (1.5x for RLS/security-adjacent review — this repo has a documented history of RLS regressions from copying policy SQL incorrectly)
  - Pre-mortem: If this takes 3x longer, it will be because the RLS policy silently diverges from `tool_call_log`'s owner+team_member semantics (the exact bug class in `feedback_rls_function_diff` — a dropped OR-branch cost 12h of broken owner access previously). Mitigate by copying the policy body verbatim, not reimplementing.
  - Notes: This is the only task touching `supabase/migrations/`.

- [ ] **Task 2a — Extract secret scanner to `@tages/shared` with redaction** — Move `scanForSensitiveData`/`hasHighSeverity`/`formatSafetyWarnings` logic into `packages/shared/src/safety.ts`, re-export unchanged from `packages/server/src/tools/safety.ts` so existing imports (`remember.ts`, `schemas.ts`) keep working with zero call-site changes. Add a new `redactSensitiveData(text): string` function (replaces matched spans with `[REDACTED:<type>]` rather than only warning) — the harness needs actual redaction, not just a warning, before anything touches disk.
  - Files: Creates `packages/shared/src/safety.ts`. Modifies `packages/shared/src/index.ts` (export), `packages/shared/src/package.json` (add `vitest` devDependency + `test`/`typecheck` scripts, matching `cursor-plugin`'s package.json shape — shared currently has no test script at all), `packages/server/src/tools/safety.ts` (re-export from `@tages/shared`).
  - Tests: `packages/shared/src/__tests__/safety.test.ts` — new redaction tests (AWS key, GitHub token, password field all get replaced, not just flagged). Existing `packages/server/src/__tests__/safety.test.ts` continues to pass unchanged (proves the re-export preserves behavior).
  - Depends on: none
  - Effort: S
  - Notes: Only task touching `packages/shared/src/safety.ts` and `packages/server/src/tools/safety.ts`.

- [ ] **Task 2b — Claude Code hook capture package** — New package `packages/harness-claude-code/` (mirrors `packages/cursor-plugin`'s file layout: `package.json`, `tsconfig.json`, `README.md`, `src/index.ts`, `src/__tests__/`). `src/index.ts` is the hook entrypoint: reads the Claude Code hook JSON payload from stdin for PreToolUse/PostToolUse/SessionEnd/Stop events, normalizes each to the `HarnessEvent` type (see Type Dependencies), redacts via `redactSensitiveData` from `@tages/shared` (Task 2a), and appends to a local SQLite log. `src/local-log.ts` implements the SQLite schema (mirrors `packages/server/src/cache/query-log.ts`'s minimal `better-sqlite3` + WAL pattern) at `~/.config/tages/cache/<slug>-harness.db`.
  - Files: Creates `packages/harness-claude-code/package.json`, `packages/harness-claude-code/tsconfig.json`, `packages/harness-claude-code/README.md`, `packages/harness-claude-code/src/index.ts`, `packages/harness-claude-code/src/local-log.ts`, `packages/harness-claude-code/src/__tests__/index.test.ts`, `packages/harness-claude-code/src/__tests__/local-log.test.ts`.
  - Tests: fixture-driven — synthetic PreToolUse/PostToolUse/SessionEnd/Stop JSON payloads parse into the expected `HarnessEvent` shape; a fixture payload containing a fake AWS key and a password field is asserted to contain **no literal secret substring** in the row written to the local DB; N synthetic events produce N rows in the local SQLite file; malformed/unrecognized hook JSON does not crash the process (hooks running in the agent's live turn must fail closed/silently, never block the agent).
  - Depends on: Task 2a (redaction function)
  - Effort: L (new package against an external hook protocol we are inferring from general Claude Code knowledge rather than verified in this repo — see Open Question 1's sibling assumption below; secret-redaction correctness is safety-critical)
  - Pre-mortem: If this takes 3x longer, it will be because the actual Claude Code hook JSON payload shape (field names for `tool_input`/`tool_response`/`session_id`/`cwd`/`hook_event_name`) differs from what's assumed here, since nothing in this repo currently exercises the hook protocol to verify against. Mitigate by writing the parser against a small, explicit adapter function (`parseHookPayload`) so a shape mismatch is a one-function fix, not a rewrite; confirm the real payload shape against Claude Code's own docs/a live `--debug` hook run before writing tests, not after.
  - Notes: Owns all files under `packages/harness-claude-code/`. No other task touches this directory.

- [ ] **Task 3 — CLI wiring: enable/disable/status/sync** — `packages/cli/src/commands/harness.ts` implements four subcommands. `enable`: requires an existing cloud project config (`loadProjectConfig`), prints exactly what will be captured/redacted/retained (sourced from Task 4's privacy copy), requires explicit confirmation, then merges (not overwrites) a hooks block into `.claude/settings.local.json` pointing at the installed `tages-harness-claude-code` bin — must preserve any pre-existing unrelated hooks entries in that file. `disable`: removes only the Tages-owned hooks block. `status`: reports enabled/disabled, last sync time, pending local row count. `sync`: reads unsynced rows from Task 2b's local log (cross-package import following the `cli-sync.ts` dist-walk pattern) and batch-inserts them into `harness_tool_events` in one Supabase call via `createAuthenticatedClient`, not one call per row.
  - Files: Creates `packages/cli/src/commands/harness.ts`, `packages/cli/src/__tests__/harness.test.ts`. Modifies `packages/cli/src/index.ts` (register the four subcommands, following the existing `.command('drift')` registration pattern at lines ~511-526).
  - Tests: `enable` against a temp-dir fixture asserts the hooks block is written and any pre-existing unrelated hooks entries in a fixture `.claude/settings.local.json` are preserved untouched; `enable` refuses when no cloud project config exists; `sync` against a mocked Supabase client asserts one batched `.insert()` call carrying all pending rows, not N calls; `disable` removes only the Tages block from a fixture file with mixed content.
  - Depends on: Task 1 (target table), Task 2b (local log format to read from)
  - Effort: L (M base × 1.5 serial multiplier — this is the integration point every other Milestone-1 task's output flows through, and the merge-not-overwrite requirement against a file real users may already have populated with unrelated hooks is the highest-risk single behavior in the whole plan)
  - Pre-mortem: If this takes 3x longer, it will be because merging into a possibly-already-populated `.claude/settings.local.json` (other plugins' hooks, personal permissions) needs careful JSON-patch semantics rather than a naive overwrite, and getting it wrong corrupts a file outside Tages' normal blast radius. Mitigate with a dedicated fixture that pre-populates unrelated hooks before writing the merge logic.
  - Notes: Only task touching `packages/cli/src/index.ts` in this plan.

- [ ] **Task 4 — Privacy policy amendment + consent copy** — Amend `PRIVACY.md`: remove/qualify the "Your IDE or editor activity" line under "What we do NOT collect" (Section 2) and add a new subsection describing the opt-in instrumented harness — what's captured (tool name, redacted args/paths, exit codes, durations, timestamps, session/agent id), what's redacted before it ever touches disk (secrets/PII per Task 2a), what's local-only vs. synced, and retention (proposed default: 90-day rolling window server-side, matching drift's own windowing needs; local retention unbounded until the user deletes `.tages/`/cache). This is the copy Task 3's `enable` confirmation prompt should quote.
  - Files: Modifies `PRIVACY.md`.
  - Tests: none (documentation task). Definition of Done substitutes: before Milestone 1 ships, confirm Task 3's actual `enable` prompt text matches this document's language.
  - Depends on: none structurally, but must land before Milestone 1 ships since it describes the feature it gates.
  - Effort: S
  - Notes: Only task touching `PRIVACY.md`. Needs Ryan's explicit sign-off (Open Question 4) since this is a people-data policy for his own team, not just an engineering choice.

- [ ] **Task 5 — Merge `harness_tool_events` into drift computation** — In `packages/cli/src/commands/drift.ts`, add a second Supabase query against `harness_tool_events`, project both `tool_call_log` and `harness_tool_events` rows down to the shared `ToolCallRow` shape (`project_id, session_id, agent_name, tool_name, created_at`), concatenate before calling `computeDrift`. No changes needed anywhere in `packages/server/src/drift/*` — confirmed source-agnostic (Finding 4). Add a `source` field to `--json` output for debuggability of which table each row came from.
  - Files: Modifies `packages/cli/src/commands/drift.ts`. Extends existing `packages/cli/src/__tests__/drift.test.ts` (do not create a new test file — this file already exercises the drift command's data-fetch step).
  - Tests: an agent with 3 `tool_call_log` calls + 3 `harness_tool_events` calls in the same window now clears the existing ≥5-per-window eligibility threshold in `computeBehavioralDrift` that neither source alone would meet — this is the direct value of this task, assert it explicitly; rows from both tables appear in the merged JSD input.
  - Depends on: Task 1 (schema), Task 3 (real batch-synced row format to project from). Soft dependency: some real baseline data collected during Milestone 1's rollout window before this is meaningful to verify end-to-end.
  - Effort: M
  - Pre-mortem: If this takes 3x longer, it will be because `agent_name` conventions differ between the MCP path (`process.env.TAGES_AGENT_NAME`, frequently unset/null today) and the harness path (Claude Code's actual session identity), so the two sources never land in the same eligible-agent bucket and the merge is a no-op in practice. Mitigate by standardizing agent-name resolution across both write paths before writing this task's tests.
  - Notes: Only task touching `packages/cli/src/commands/drift.ts`.

- [ ] **Task 6 (OPTIONAL, not on either milestone's critical path) — Wire the dormant MCP session recorder into `tool_call_log`** — Closes Finding 1: `globalSessionRecorder.recordToolCall()` (`packages/server/src/analytics/session-recorder.ts`) is defined but never invoked in `packages/server/src/index.ts`. Every `server.tool()` registration already routes through the `withGate()` wrapper (defined at `packages/server/src/index.ts:98`) — call `recordToolCall` inside `withGate`, and flush accumulated calls to `tool_call_log` on `SIGINT`/session end alongside the existing `tracker.endSession()` calls (lines 379, 818).
  - Files: Modifies `packages/server/src/index.ts`, `packages/server/src/analytics/session-recorder.ts` (add a Supabase-flush method). Creates `packages/server/src/__tests__/tool-call-log-write.test.ts`.
  - Tests: invoking a mocked tool through `withGate` results in a row inserted into a mocked `tool_call_log` matching tool_name/session_id/agent_name.
  - Depends on: none (independent of Tasks 1-5)
  - Effort: M
  - Pre-mortem: If this takes 3x longer, it will be because `withGate` wraps individual tool handlers, not a single central dispatcher, so threading a session-scoped batch buffer through ~50 call sites correctly (without double-counting retried calls or missing the flush on abnormal exit) takes more surgical changes than the one-line description implies. Mitigate by adding the recording call inside `withGate` itself (one function, one place) rather than per-handler.
  - Notes: **This was not requested in the original scope** — it's a bug fix discovered while reading the code for this plan. Include only if Ryan confirms (Open Question 5). If included, it makes the "additive to MCP, not replacing it" framing actually true today (currently the MCP side contributes zero rows, so the harness would be the only data source in practice until this ships).

## File Ownership Matrix

| Task | Creates | Modifies |
|------|---------|----------|
| 1 | `supabase/migrations/0059_harness_tool_events.sql` | — |
| 2a | `packages/shared/src/safety.ts`, `packages/shared/src/__tests__/safety.test.ts` | `packages/shared/src/index.ts`, `packages/shared/src/package.json`, `packages/server/src/tools/safety.ts` |
| 2b | `packages/harness-claude-code/**` (package.json, tsconfig.json, README.md, src/index.ts, src/local-log.ts, src/__tests__/*) | — |
| 3 | `packages/cli/src/commands/harness.ts`, `packages/cli/src/__tests__/harness.test.ts` | `packages/cli/src/index.ts` |
| 4 | — | `PRIVACY.md` |
| 5 | — | `packages/cli/src/commands/drift.ts`, `packages/cli/src/__tests__/drift.test.ts` |
| 6 (optional) | `packages/server/src/__tests__/tool-call-log-write.test.ts` | `packages/server/src/index.ts`, `packages/server/src/analytics/session-recorder.ts` |

No file appears in two tasks' columns. Confirmed zero overlaps — Tasks 1, 2a, 4, 6 can run fully in parallel; 2b depends on 2a; 3 depends on 1 and 2b; 5 depends on 1 and 3.

## Open Questions

- [ ] **OQ1 — Is the Mersive team actually on Claude Code?** This plan assumes it per the stated scope. If any engineers use Cursor/Codex/Gemini instead, this plan's Milestone 1 captures nothing for them until a sibling harness package ships (architected as an extension point, Task 2b + `HarnessEvent`, but not built here). Blocks: nothing structurally (v1 scope already fixed to Claude Code per the prompt), but affects how much of the team's baseline is actually captured next week. Default if unresolved: proceed with Claude Code only; verify the team's actual tool roster before rollout and flag any gap explicitly rather than assuming full coverage.
- [ ] **OQ2 — New table vs. extending `tool_call_log`?** Recommendation: new table `harness_tool_events` (Task 1), reasoning in Technical Approach and Finding 4. Blocks: Task 1's design. Default if unresolved: proceed with the new-table design as specified — the reasoning is strong and the alternative (extending `tool_call_log`) risks the existing (currently dark, per Finding 1) MCP write path for no benefit.
- [ ] **OQ3 — Transport: batch vs. per-call?** Recommendation: local batch (Task 3's `sync` subcommand), reasoning in Technical Approach. Blocks: Task 3's design. Default if unresolved: proceed with batch sync, triggered on a timer and on SessionEnd hook, whichever fires first.
- [ ] **OQ4 — Privacy/opt-in model.** Recommendation: per-developer opt-in via `tages harness enable`, hooks written to the gitignored-by-convention `.claude/settings.local.json` (not the shared/committed `.claude/settings.json`), redact-before-persist (not warn-only), no raw uncapped payloads ever leave the machine, proposed 90-day server-side retention. This is a people-data policy for Ryan's own team and needs his explicit sign-off before Task 4/Task 3 ship, not just an engineering default. Blocks: Task 3 and Task 4's final copy. Default if unresolved: ship with the proposed model as documented in Task 4, revisit before any rollout beyond the initial Mersive team.
- [ ] **OQ5 — Include optional Task 6?** Wiring the dormant MCP session-recorder into `tool_call_log` was not part of the requested scope but was discovered during Step 1 reading (Finding 1) and directly affects whether "additive to MCP" is true in practice today. Blocks: nothing (Task 6 is fully independent). Default if unresolved: exclude from this plan's two milestones; open as a separate, explicitly-scoped bug-fix ticket.
- [ ] **OQ6 — Claude Code hook JSON payload shape.** Task 2b's parser is built against an assumed shape (PreToolUse/PostToolUse/SessionEnd/Stop with `tool_name`, `tool_input`, `tool_response`, `session_id`, `cwd`, `hook_event_name`) inferred from general Claude Code knowledge, not verified against this repo (Finding 3 — no existing hooks precedent here). Blocks: Task 2b's implementation start. Default if unresolved: confirm the real payload shape against Claude Code's current docs or a live `--debug` hook trace before writing Task 2b's parser, not after — this is cheap to verify and expensive to get wrong after tests are written against a guessed shape.

## Definition of Done

- [ ] Code written and self-reviewed
- [ ] Tests written or updated for changed logic (per-task criteria above)
- [ ] Quality gates pass (code review, tests, security review) — security review specifically covers Task 2b's redaction correctness and Task 1's RLS policy, given the privacy-sensitive nature of this feature
- [ ] `PRIVACY.md` amendment (Task 4) lands no later than Milestone 1, and its consent language matches Task 3's actual `enable` prompt text
- [ ] PR opened with coverage gaps noted in description
- [ ] Milestone 1 (Tasks 1, 2a, 2b, 3, 4) ships before the Mersive team's rollout next week; Milestone 2 (Task 5) and optional Task 6 can follow after
