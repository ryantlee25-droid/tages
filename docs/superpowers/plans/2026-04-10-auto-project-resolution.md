# Plan: Auto Project Resolution
_Created: 2026-04-10 | Type: New Feature_

## Goal

When the MCP server starts via `npx @tages/server` in any directory, it automatically identifies the active project, hydrates its memories from Supabase, and serves MCP requests — without requiring `tages init` to have been run in that specific directory.

## Background

Currently the server reads `TAGES_PROJECT_SLUG` from the environment (set by `tages init` into the Claude Desktop config). That env var is project-specific and static — it bakes one project into the global MCP config. As a Claude Code plugin, the server starts in whatever directory the user opens, but the env var always points to the last project that ran `tages init`. Opening `~/projects/the-remnant` with the MCP server still loads the `tages` project's memories.

The fix is a project detection layer in `packages/server/src/config.ts` that resolves the active project from the working directory at startup, falling back to auto-creation when no match is found.

## Scope

**In scope:**
- Project auto-detection (`.tages/config.json`, git remote match, directory name match)
- Auto-creation of a new local-only or cloud project when no match found
- Lazy staleness-checked cloud hydration on startup for the detected project
- `TAGES_CWD` env var support so the MCP host can pass the working directory
- Backward compatibility: projects registered via `tages init` continue to work unchanged
- CLI `tages status` updated to show auto-detected project info

**Out of scope:**
- Multi-project memory federation (already exists as a separate XL7 feature)
- Migrating the per-slug `.db` files to a single shared database (schema already supports it, but the cache layer works correctly per-slug and a migration would risk data loss)
- Auto-detecting project when the Claude Desktop MCP config still has a hard-coded `TAGES_PROJECT_SLUG` env var (that env var still takes priority — users must remove it to opt into auto-detection)
- Changes to the `mcp-inject.ts` writing of `TAGES_PROJECT_SLUG` during `tages init` (existing flow is unchanged)

## Technical Approach

### Detection chain (executed in `packages/server/src/config.ts`)

The new `resolveProject(cwd: string): ProjectConfig | null` function runs four strategies in order and returns the first match:

1. **`.tages/config.json` marker** — read `${cwd}/.tages/config.json` if it exists; use its `slug` field to load from `~/.config/tages/projects/<slug>.json`. This is the explicit, fast path.

2. **Git remote URL match** — run `git -C ${cwd} remote get-url origin` (sync child_process exec with timeout). Normalize the URL (strip `.git`, extract `owner/repo`). Compare against every registered project's `slug` field (exact match, then `repo` segment match). This covers `~/projects/the-remnant` when the slug matches the GitHub repo name.

3. **Directory name match** — `path.basename(cwd)` compared against registered project slugs. Fast, no subprocess, works for the 80% case where the directory and slug agree.

4. **Auto-create** — if authenticated (`~/.config/tages/auth.json` exists with valid tokens): call Supabase to create a new project using the directory name as slug, write `~/.config/tages/projects/<slug>.json`, and return the new config. If not authenticated: write a local-only project config (`projectId: local-<slug>`, empty supabase fields) and return it.

### Entry point changes (`packages/server/src/index.ts`)

`main()` currently calls `loadServerConfig(process.env.TAGES_PROJECT_SLUG)`. The new flow:

```
1. If TAGES_PROJECT_SLUG is set → use existing loadServerConfig() (unchanged, backward compat)
2. Else → determine cwd (process.env.TAGES_CWD || process.cwd())
        → call resolveProject(cwd)
        → if null, use local fallback project (local-unknown, /tmp/tages-unknown.db)
```

`TAGES_CWD` is a new env var that MCP hosts (e.g. Claude Code) can inject to tell the server which directory is active. Without it, `process.cwd()` is used, which is correct for stdio servers.

### Staleness guard (`packages/server/src/sync/supabase-sync.ts`)

The existing `hydrate()` method already checks `sync_meta.last_synced_at` and skips a full pull if the cache is current. No changes needed to hydration logic itself.

A new guard is added in `index.ts` before calling `sync.hydrate()`: check if `last_synced_at` is within the last 60 seconds. If so, skip hydration entirely and log a cache-hit message. This keeps startup under 2s on subsequent opens of the same project.

```typescript
const HYDRATION_TTL_MS = 60_000
const lastSync = cache.getLastSyncedAt(projectId)
const age = lastSync ? Date.now() - new Date(lastSync).getTime() : Infinity
if (age < HYDRATION_TTL_MS) {
  console.error(`[tages] Cache fresh (${Math.round(age/1000)}s old) — skipping hydration`)
} else {
  const count = await sync.hydrate()
  // ...
}
```

### Auto-creation in cloud mode

When detection finds no match and auth tokens exist, auto-creation reuses the existing Supabase project creation logic extracted from `packages/cli/src/commands/init.ts`. To avoid duplicating this logic:

- Extract a `createCloudProject(slug, supabase)` async helper into `packages/shared/src/project-factory.ts`.
- `init.ts` imports and calls it.
- `resolveProject()` in `packages/server/src/config.ts` imports and calls it.

Note: `packages/shared` is shared infrastructure — changes here affect the CLI, server, and dashboard. The new `project-factory.ts` file is additive (no existing exports change).

### `.tages/config.json` marker file format

```json
{ "slug": "the-remnant" }
```

Written by a new `tages link` CLI command (or by `tages init` as a side effect in the current directory). This is the long-term explicit opt-in that eliminates guessing.

## Tasks

- [ ] **Task 1: Extract `createCloudProject` into shared** — Pull the Supabase project-creation logic from `init.ts` into a new `packages/shared/src/project-factory.ts` helper so both the CLI and server can call it without duplicating the Supabase client setup or error handling.
  - Files:
    - Create: `packages/shared/src/project-factory.ts`
    - Modify: `packages/shared/src/index.ts` (re-export)
    - Modify: `packages/cli/src/commands/init.ts` (import + call shared helper instead of inline code)
  - Tests: Add unit test in `packages/server/src/__tests__/project-factory.test.ts` verifying that `createCloudProject` calls `supabase.from('projects').insert(...)` with correct shape and returns a `ProjectConfig`. Mock Supabase.
  - Depends on: nothing
  - Notes: The `createSupabaseClient` import pattern is already established in `init.ts` — follow it exactly. Supabase returns PromiseLike, wrap with `Promise.resolve()` before `.catch()` per project convention.

- [ ] **Task 2: Implement `resolveProject(cwd)` in server config** — Add the four-strategy detection chain to `packages/server/src/config.ts`. The function reads registered project files, runs git subprocess for strategy 2, and calls `createCloudProject` for strategy 4.
  - Files:
    - Modify: `packages/server/src/config.ts`
  - Tests: Extend `packages/server/src/__tests__/startup.test.ts` with cases for:
    - `.tages/config.json` present and matching a registered project → returns that project
    - Git remote URL matches a registered project slug → returns that project
    - Directory name matches a registered slug → returns that project
    - No match, not authenticated → returns a local-only config with `projectId: local-<slug>`
    - No match, authenticated → calls `createCloudProject` (mock it)
    - Registered projects dir is empty → falls through to auto-create
  - Depends on: Task 1
  - Pre-mortem: If this task fails or takes 3x longer, it will be because: the `git remote` subprocess is flaky (git not installed, repo has no remote, timeout on slow mounts). Must handle all these gracefully with try/catch and fall through to the next strategy. Strategy 2 timeout must be ≤300ms to keep startup fast.
  - Notes: Use `child_process.execSync` with `{ timeout: 300, stdio: 'pipe' }` for the git subprocess. Do not use async git exec — startup must remain synchronous up to the hydration step.

- [ ] **Task 3: Add `TAGES_CWD` support and wire `resolveProject` in server entry point** — Update `packages/server/src/index.ts` to call `resolveProject` when `TAGES_PROJECT_SLUG` is not set, and add the 60-second hydration staleness guard.
  - Files:
    - Modify: `packages/server/src/index.ts`
  - Tests: Integration test in `packages/server/src/__tests__/startup.test.ts`: mock `resolveProject` returning a local-only config, verify server starts and `projectId` is set correctly. Add a staleness guard test: mock `cache.getLastSyncedAt` returning a timestamp 30s ago, verify `sync.hydrate()` is not called.
  - Depends on: Task 2
  - Pre-mortem: If this task fails or takes 3x longer, it will be because: the `main()` function is 750 lines and the detection insertion point is easy to mis-sequence — must land before the `SupabaseSync` constructor call, which uses `projectId`. Read the exact lines before editing.

- [ ] **Task 4: Add `tages link` CLI command** — New CLI command that writes `.tages/config.json` in the current directory with the resolved slug. Enables users to explicitly link a directory to a registered project, bypassing git-remote inference.
  - Files:
    - Create: `packages/cli/src/commands/link.ts`
    - Modify: `packages/cli/src/index.ts` (register command)
  - Tests: Unit test in `packages/cli/src/__tests__/link.test.ts`: verify it writes `.tages/config.json` with correct slug when a matching project config exists; verify it errors when slug is not registered.
  - Depends on: Task 2 (needs to know the registered slugs format)
  - Notes: `tages link [slug]` — if slug omitted, default to directory name. If slug is registered, write `.tages/config.json`. If not registered, print a helpful error suggesting `tages init`.

- [ ] **Task 5: Update `tages status` to show auto-detected project** — The existing `status` command shows which project is active. Update it to show whether the project was detected automatically and by which strategy (marker file, git remote, dirname, auto-created).
  - Files:
    - Modify: `packages/cli/src/commands/status.ts` (or equivalent status command file)
    - Modify: `packages/server/src/config.ts` (add `detectionMethod` field to resolved config, optional string)
  - Tests: Update existing status tests to assert the detection method is printed when present.
  - Depends on: Task 2
  - Notes: Detection method is informational only — do not change behavior based on it.

- [ ] **Task 6: Update README with auto-detection behavior** — Document the new zero-config startup flow, the `.tages/config.json` marker, `TAGES_CWD`, and `tages link` in the project README.
  - Files:
    - Modify: `README.md`
  - Tests: N/A (docs)
  - Depends on: Tasks 3, 4

## File Ownership Matrix

| Task | Creates | Modifies |
|------|---------|----------|
| Task 1 | `packages/shared/src/project-factory.ts` | `packages/shared/src/index.ts`, `packages/cli/src/commands/init.ts` |
| Task 2 | — | `packages/server/src/config.ts`, `packages/server/src/__tests__/startup.test.ts` |
| Task 3 | — | `packages/server/src/index.ts`, `packages/server/src/__tests__/startup.test.ts` |
| Task 4 | `packages/cli/src/commands/link.ts`, `packages/cli/src/__tests__/link.test.ts` | `packages/cli/src/index.ts` |
| Task 5 | — | `packages/cli/src/commands/status.ts`, `packages/server/src/config.ts` |
| Task 6 | — | `README.md` |

**File conflict check**: `packages/server/src/config.ts` appears in Tasks 2 and 5. Resolution: Task 2 completes first (it adds `resolveProject` and the function body). Task 5 adds only the `detectionMethod` field to the returned config object — a small additive change. Make Task 5 depend on Task 2 (already stated). Sequential execution avoids conflict.

`packages/server/src/__tests__/startup.test.ts` appears in Tasks 2 and 3. Resolution: Task 2 adds new `describe` blocks for `resolveProject`. Task 3 adds new `describe` blocks for server startup wiring. These are additive additions to the same file — do not let them run in parallel. Task 3 depends on Task 2 (already stated).

## Open Questions

- [ ] **Does Claude Code pass `cwd` to MCP servers?** — Blocks: Task 3. Default if unresolved: use `process.cwd()` only, document that `TAGES_CWD` is available for hosts that can inject it. Who: Ryan (test by checking Claude Code stdio server docs or inspecting the actual env at startup via a quick log).

- [ ] **Should `tages init` write `.tages/config.json` automatically?** — Blocks: nothing (Task 4 handles this as `tages link`). Default if unresolved: `tages init` does NOT write the marker; `tages link` is the explicit opt-in. This keeps `init` behavior unchanged and avoids surprise files appearing in project repos.

- [ ] **Free tier project limit behavior during auto-create** — Blocks: Task 1 (auto-create path). Default if unresolved: if Supabase returns a tier-limit error during auto-create, fall back silently to a local-only project rather than erroring the server out. Log a warning. Who: Ryan (check current tier limit behavior in `init.ts` line 136).

## Definition of Done

- [ ] Code written and self-reviewed
- [ ] Tests written or updated — all 598 existing tests still pass; new tests cover all four detection strategies and the staleness guard
- [ ] `pnpm typecheck` passes across all packages
- [ ] `pnpm test` passes with no regressions
- [ ] PR opened; coverage gaps noted in description
- [ ] Manual smoke test: open a registered project directory in Claude Code, verify server starts and recalls the correct project's memories within 2 seconds
- [ ] Manual smoke test: open an unregistered directory, verify server auto-creates a local project and starts cleanly
