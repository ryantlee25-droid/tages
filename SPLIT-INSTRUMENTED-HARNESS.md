# SPLIT: instrumented-harness-milestone-1

Source plan: `/Users/ryan/projects/tages/PLAN-INSTRUMENTED-HARNESS.md`
Scope: **Milestone 1 only** — Tasks 1, 2a, 2b, 3, 4. Task 5 (drift merge) is Milestone 2, out of scope here. Task 6 (dead MCP write path) is deferred to Milestone 2 per Ryan's explicit instruction — excluded entirely, no Howler touches it.

## Confirmed decisions applied (not re-litigated)

1. All developers on Claude Code → single capture path (`packages/harness-claude-code`), no hedging for Cursor/Codex/Gemini in Milestone 1 code.
2. Task 6 deferred — dropped from this split.
3. Schema = new `harness_tool_events` table (matches Blue's plan default, no conflict).
4. Transport = batch via CLI `sync` subcommand (matches Blue's plan default, no conflict).
5. Privacy model = **per-developer opt-in** (Ryan confirmed the plan's OQ4 default 2026-07-09): `tages harness enable` writes hooks to the **gitignored `.claude/settings.local.json`**, secrets **redacted before anything touches disk**, **90-day server-side retention**, `PRIVACY.md` amended to disclose the opt-in harness. This matches Blue's plan default exactly — no reconciliation conflict. (Supersedes the "team-managed/central" premise a prior draft of this SPLIT assumed; that premise is withdrawn.)

## Reconciliation against Blue's File Ownership Matrix (plan lines 118-130)

Re-verified path-by-path. **Zero file overlap** across the 5 in-scope tasks — confirmed accurate, no changes needed to the matrix itself:

| Task | Creates | Modifies |
|------|---------|----------|
| 1 | `supabase/migrations/0059_harness_tool_events.sql` | — |
| 2a | `packages/shared/src/safety.ts`, `packages/shared/src/__tests__/safety.test.ts` | `packages/shared/src/index.ts`, `packages/shared/src/package.json`, `packages/server/src/tools/safety.ts` |
| 2b | `packages/harness-claude-code/**` (package.json, tsconfig.json, README.md, src/index.ts, src/local-log.ts, src/__tests__/*) | — |
| 3 | `packages/cli/src/commands/harness.ts`, `packages/cli/src/__tests__/harness.test.ts` | `packages/cli/src/index.ts` |
| 4 | — | `PRIVACY.md` |

No conflicts on **files**. No content conflicts either: Ryan confirmed the plan's OQ4 default on 2026-07-09, so Howler-C (Task 4) and Howler-D (Task 3) build to the plan as written — target `.claude/settings.local.json`, per-developer opt-in, 90-day retention. The prior draft's Flag A (committed settings file) and Flag B (unspecified "richer" retention) are both **withdrawn** — they existed only under the reversed team-managed premise, which Ryan did not choose.

## Howler Assignments

### Howler-A — Migration (Task 1)

**Owns (exclusive):**
- Creates: `supabase/migrations/0059_harness_tool_events.sql`

**Task:** New `harness_tool_events` table per the plan's Task 1 spec (`project_id, session_id, agent_name, source TEXT, tool_name, event_type TEXT, exit_code INTEGER, file_path TEXT, duration_ms INTEGER, args_scrubbed JSONB, result_summary TEXT, secrets_redacted_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ`). RLS policy copied **verbatim** from `tool_call_log`'s policy in `0030_analytics.sql` — do not reimplement via a helper function.

**Dependencies:** None. Fully independent, Wave 1.

**Memory brief for this Howler:**
- `feedback_rls_function_diff` — a dropped OR-branch in a copied RLS policy previously cost 12h of broken owner access. Copy the `tool_call_log` policy body verbatim, do not paraphrase or "improve" it.
- `feedback_supabase_migration_list_linked` — run `supabase migration list --linked` before finalizing the migration number, to confirm `0059` is actually the next unclaimed number against the linked prod project, not just the highest local file.
- Manual RLS smoke test as two simulated users is part of Definition of Done for this task (documented psql steps in the migration's own comment header) — this repo has no automated pgTAP harness.

---

### Howler-B — Shared secret scanner + Claude Code capture package (Tasks 2a + 2b combined)

**Owns (exclusive):**
- Creates: `packages/shared/src/safety.ts`, `packages/shared/src/__tests__/safety.test.ts`
- Modifies: `packages/shared/src/index.ts`, `packages/shared/src/package.json`, `packages/server/src/tools/safety.ts`
- Creates: `packages/harness-claude-code/package.json`, `packages/harness-claude-code/tsconfig.json`, `packages/harness-claude-code/README.md`, `packages/harness-claude-code/src/index.ts`, `packages/harness-claude-code/src/local-log.ts`, `packages/harness-claude-code/src/__tests__/index.test.ts`, `packages/harness-claude-code/src/__tests__/local-log.test.ts`

**Deviation from Blue's plan, flagged explicitly:** Blue scoped 2a and 2b as separate tasks assigned to (presumably) separate agents. This SPLIT **consolidates them into one Howler** because 2b has a hard dependency on 2a's `redactSensitiveData` export and there is zero file overlap with any other task either way — merging avoids a wave-gate + intermediate merge for a dependency that would otherwise block Howler-B's own second half anyway. Net effect on critical path: none (2b was always serial after 2a); net effect on coordination overhead: removes one merge/handoff. If Ryan prefers strict 1:1 task-to-Howler mapping, split this into Howler-B1 (2a) and Howler-B2 (2b, dropped after B1 completes) — file ownership is identical either way, just an extra wave.

**Task:**
- 2a: Move `scanForSensitiveData`/`hasHighSeverity`/`formatSafetyWarnings` into `packages/shared/src/safety.ts`; re-export unchanged from `packages/server/src/tools/safety.ts` so `remember.ts`/`schemas.ts` need zero call-site changes. Add `redactSensitiveData(text): string` — replaces matched spans with `[REDACTED:<type>]`. Add `vitest` devDependency + `test`/`typecheck` scripts to `packages/shared/src/package.json` (mirror `cursor-plugin`'s package.json shape — shared currently has no test script).
- 2b: New package `packages/harness-claude-code/` mirroring `packages/cursor-plugin`'s layout. `src/index.ts` reads Claude Code hook JSON from stdin for PreToolUse/PostToolUse/SessionEnd/Stop, normalizes to `HarnessEvent` (new type — also add to `packages/shared/src/types.ts` as part of this Howler's work per the plan's Type Dependencies section, since no other Howler owns that file and it's needed by this package), redacts via `redactSensitiveData`, appends to local SQLite (`src/local-log.ts`, mirrors `packages/server/src/cache/query-log.ts`'s `better-sqlite3` + WAL pattern) at `~/.config/tages/cache/<slug>-harness.db`.

**Dependencies:** None external — internal ordering is 2a before 2b, both within this one Howler. Wave 1 (runs concurrently with Howler-A and Howler-C).

**Memory brief for this Howler:**
- **OQ6 RESOLVED — real Claude Code hook payload contract (verified, build to this, not a guess).** Every hook receives a single JSON object on **stdin**. Common fields on all events: `session_id` (string), `transcript_path` (string), `cwd` (string), `hook_event_name` (string, one of `"PreToolUse"|"PostToolUse"|"SessionEnd"|"Stop"`). Per-event additions:
  - `PreToolUse`: `tool_name` (string), `tool_input` (object — schema varies by tool: e.g. Bash → `{command, description}`, Edit → `{file_path, old_string, new_string}`, Read → `{file_path}`).
  - `PostToolUse`: `tool_name`, `tool_input`, and `tool_response` (object — the tool result; shape varies, may include `stdout`/`stderr`/`interrupted` for Bash, file content for Read, etc.).
  - `SessionEnd`: `reason` (string — e.g. `"clear"|"logout"|"prompt_input_exit"|"other"`).
  - `Stop`: `stop_hook_active` (boolean).
  There is **no top-level `exit_code` or `duration_ms`** — for Bash, exit status lives inside `tool_response` (and may be absent); `duration_ms` is not provided by the hook protocol, so derive it by pairing a PostToolUse with its matching PreToolUse by `session_id`+`tool_name`+ordering, or leave it null. `file_path` is inside `tool_input`, not top-level. Still wrap parsing in one `parseHookPayload` adapter so a future protocol change is a one-function fix, and still fail closed on any unrecognized shape. A hook returns exit code 0 (allow) on stdout; **capture must never emit blocking output** — write to the local DB and exit 0 regardless.
- `feedback_esm_cjs_crosspackage` — not directly this Howler's problem (that's Howler-D's cross-package import of this package's dist), but keep the local-log module's exports CJS/ESM-interop-friendly since Howler-D will need `createRequire` + path-walk to reach it, matching `cli-sync.ts`'s existing pattern.
- Secret redaction correctness is safety-critical: the test fixture with a fake AWS key and a password field must assert **no literal secret substring** appears in the row written to the local DB, not just that a warning was logged.
- Malformed/unrecognized hook JSON must fail closed and silently — hooks run in the agent's live turn and must never throw or block the user's tool call.

---

### Howler-C — PRIVACY.md amendment (Task 4)

**Owns (exclusive):**
- Modifies: `PRIVACY.md`

**Task:** Remove/qualify the "Your IDE or editor activity" line under "What we do NOT collect" (Section 2). Add a new subsection describing the opt-in instrumented harness: what's captured (tool name, redacted args/paths, exit codes, durations, timestamps, session/agent id), what's redacted before it ever touches disk, what's local-only vs. synced, and retention.

**Apply Ryan's confirmed privacy model directly** (the plan's OQ4 default, approved 2026-07-09): capture is **per-developer opt-in** — each developer runs `tages harness enable` themselves; it is not forced team-wide. State plainly what's captured, that **secrets are redacted before anything is written to disk or synced** (raw payloads never leave the machine), that hook config lives in the developer's own gitignored `.claude/settings.local.json`, and **90-day server-side retention** (local cache retained until the developer clears it). Write 90 days as the committed retention number, not a "proposed/pending" placeholder — Ryan signed off on it.

**Dependencies:** None structurally — Wave 1. Content coupling only: Howler-D's `enable` confirmation-prompt copy (Task 3) should end up matching this document's language. Since both Howlers receive the same confirmed-decisions bullet list in their drop prompts, they don't need to block on each other's output — but the Definition of Done step "confirm Task 3's actual `enable` prompt text matches this document's language" still applies post-merge, before PR.

**Memory brief for this Howler:**
- This is a people-data policy document for Ryan's own team (Mersive engineers starting next week) — treat the retention number and "disclosed to the team" language as needing Ryan's explicit sign-off, matching the plan's Definition of Done.

---

### Howler-D — CLI wiring: enable/disable/status/sync (Task 3)

**Owns (exclusive):**
- Creates: `packages/cli/src/commands/harness.ts`, `packages/cli/src/__tests__/harness.test.ts`
- Modifies: `packages/cli/src/index.ts` (register 4 subcommands, following the existing `.command('drift')` pattern at lines ~511-526)

**Task:** `enable`: requires an existing cloud project config (`loadProjectConfig`), prints what will be captured/redacted/retained (sourced from Howler-C's PRIVACY.md copy), then merges (not overwrites) a hooks block into the target settings file pointing at the installed `tages-harness-claude-code` bin, preserving any pre-existing unrelated hooks entries. `disable`: removes only the Tages-owned hooks block. `status`: enabled/disabled, last sync time, pending local row count. `sync`: reads unsynced rows from Howler-B's local log (cross-package import following `cli-sync.ts`'s `createRequire` + dist-walk pattern) and batch-inserts into `harness_tool_events` in one Supabase call via `createAuthenticatedClient` — one call, not one per row.

**Target file (confirmed):** `.claude/settings.local.json` (the developer's own gitignored file) — per-developer opt-in per Ryan's approved OQ4 default. Do **not** write to the shared/committed `.claude/settings.json`; the whole point is that each developer opts in for themselves. Merge-not-overwrite still applies (their local file may already hold other hooks or personal permissions). The `enable` confirmation copy frames it as "you are opting yourself in," quoting PRIVACY.md's capture/redaction/retention language (Howler-C's copy).

**Dependencies:** Task 1 (target table schema — needs Howler-A merged) and Task 2b (local log format to read from — needs Howler-B merged). **Wave 2 — do not drop until both Howler-A and Howler-B are merged to the integration branch.**

**Memory brief for this Howler:**
- `feedback_esm_cjs_crosspackage` — Tages CLI is ESM, `packages/harness-claude-code`'s dist may be CJS; use `createRequire` + path-walk to load it, exactly as `cli-sync.ts` already does for its own cross-package read.
- `feedback_supabase_promiselike` — Supabase's `.from().insert()` returns `PromiseLike`, not `Promise`; wrap with `Promise.resolve()` before `.catch()` in the batch-sync call.
- The merge-not-overwrite requirement against a file real users may already have populated (other hooks, personal permissions) is the single highest-risk behavior in this task per the plan's own pre-mortem — write a fixture with pre-populated unrelated hooks content before writing the merge logic, not after.
- `feedback_no_auto_merge` / `project_tages_branch_protection` — not this Howler's concern directly (that's Copper's job later), but don't assume this branch merges itself.

## Dependency Graph / Wave Sequencing

```
Wave 1 (parallel, drop together):
  Howler-A  — Task 1 (migration)              [independent]
  Howler-B  — Tasks 2a+2b (shared + package)   [independent]
  Howler-C  — Task 4 (PRIVACY.md)              [independent]

  ── merge all Wave 1 branches to integration branch ──

Wave 2 (drop after Wave 1 merges):
  Howler-D  — Task 3 (CLI wiring)              [depends on A's schema + B's local-log format]
```

Task 5 (drift merge, Milestone 2) and Task 6 (deferred) are not scheduled in this split.

## Parallelism Recommendation

- **4 Howlers total**, well under the 8 cap — no scaling-sanity-check concerns.
- **Max concurrency: 3** (Wave 1: Howler-A, Howler-B, Howler-C run truly concurrently).
- **1 required gate:** Howler-D (Wave 2) must not drop until Howler-A and Howler-B are both merged — it has a real file/schema dependency on both, not just a sequencing preference.
- Howler-C (PRIVACY.md) has no file dependency on anything and could technically run in either wave, but there's no reason to delay it — keep it in Wave 1.
- If strict 1:1 task-to-Howler mapping is preferred over the Task 2a/2b consolidation (see Howler-B's deviation note), this becomes 5 Howlers across 3 waves (Wave 1: A/2a/C, Wave 2: 2b, Wave 3: D) with the same max concurrency of 3 — flag which version you want before I muster.

## Post-Merge Quality Gate (unchanged from standard protocol)

One gate on the combined Wave 1 + Wave 2 diff: White (Opus) + Gray + `/diff-review`, run once. Security review should specifically cover Howler-A's RLS policy (per `feedback_rls_function_diff`) and Howler-B's redaction correctness, per the plan's own Definition of Done. Coverage/security high-medium findings are PR-description warnings, not blockers. Copper opens the PR after the gate is clean.

## Decisions resolved (2026-07-09)

- **OQ1** — All Mersive devs on Claude Code → single capture path, full coverage, no multi-harness hedging in Milestone 1.
- **OQ4** — Per-developer opt-in, `.claude/settings.local.json`, redact-before-persist, 90-day retention. Approved.
- **OQ6** — Hook payload contract verified and baked into Howler-B's brief above (no live-trace confirmation needed).
- **OQ2 / OQ3 / OQ5** — Plan defaults accepted (new `harness_tool_events` table / batch sync / Task 6 excluded).
- **Howler-B 2a+2b consolidation** — Accepted (4 Howlers, 2 waves). 2b's hard dependency on 2a's `redactSensitiveData` makes one Howler cleaner than a wave-gate for zero file-overlap cost.

Wave 1 (Howler-A, Howler-B, Howler-C) drops from the main conversation in isolated worktrees off `feat/instrumented-harness`.
