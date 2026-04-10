# Plan: Test Coverage for `resolveProject()` and Staleness Guard
_Created: 2026-04-10 | Type: New Feature (test suite)_

## Goal

Write a vitest test file that achieves comprehensive coverage of `resolveProject()`'s 4-strategy detection chain, the `extractRepoName()` and `sanitizeSlug()` helpers (exercised indirectly), and the staleness guard in `index.ts` — without touching the real filesystem, network, or child processes.

## Background

`resolveProject()` was introduced as part of the auto project resolution feature (see `2026-04-10-auto-project-resolution.md`). The function has no tests today. Its 4-strategy chain has complex branching (marker → git-remote → dirname → auto-create), with further branching inside auto-create (authenticated vs unauthenticated, cloud success vs tier-limit fallback). The staleness guard in `index.ts` is also uncovered. Both areas are reachable only through mocking, since they touch `fs`, `child_process`, and Supabase.

## Scope

**In scope:**
- All 4 detection strategies in `resolveProject(cwd)`
- All documented edge cases per strategy (corrupt JSON, no git repo, SSH/HTTPS URL formats, dir name sanitization, tier-limit fallback, auth.json corrupt)
- `extractRepoName()` — exercised indirectly through Strategy 2 test cases
- `sanitizeSlug()` — exercised indirectly through Strategy 3 and 4 test cases
- Staleness guard in `packages/server/src/index.ts` (lines 136–145): fresh cache skips hydration, stale cache triggers hydration, no prior sync triggers hydration

**Out of scope:**
- Full MCP server startup (already covered by E2E tests in `e2e-*.test.ts`)
- The `loadServerConfig()` function (covered in `startup.test.ts`)
- Real Supabase calls or network requests
- Real filesystem or child process execution

## Technical Approach

### Mocking strategy

The test file must hoist all mocks before importing the module under test. Vitest hoists `vi.mock()` calls automatically — but the import of the module under test must come *after* the mock declarations (or use dynamic `import()`).

Three mock targets:
1. `'fs'` — mock `existsSync`, `readFileSync`, `readdirSync`, `mkdirSync`, `writeFileSync`
2. `'child_process'` — mock `execSync`
3. `'@tages/shared'` — mock `createSupabaseClient`, `createCloudProject`, `createLocalProject`

Pattern from `startup.test.ts`:
```typescript
import * as fsModule from 'fs'
vi.mock('fs')
// ... then import the module under test
import { resolveProject } from '../config.js'
```

For `child_process`, the same pattern applies:
```typescript
import * as childProcess from 'child_process'
vi.mock('child_process')
```

For `@tages/shared`, mock the entire module:
```typescript
vi.mock('@tages/shared', () => ({
  createSupabaseClient: vi.fn(),
  createCloudProject: vi.fn(),
  createLocalProject: vi.fn(),
}))
```

### Helper-function access

`sanitizeSlug` and `extractRepoName` are module-private. They are not exported. Do not export them — exercise them through `resolveProject()` edge cases. Each strategy test that depends on these helpers implicitly validates them.

If a test needs to assert the exact output of `sanitizeSlug` or `extractRepoName` in isolation, export them with `@internal` JSDoc markers — but only if the plan author decides this is worth the coupling cost. The current plan avoids this: all assertions are on the `ResolvedProject` return value or thrown errors.

### Staleness guard

The staleness guard lives in `packages/server/src/index.ts` inside the `main()` function (or equivalent startup block). It is not exported. To test it without spinning up the full MCP server:

- Extract the staleness guard logic into a small, exported pure function in `packages/server/src/cache/sqlite.ts` or a new `packages/server/src/hydration.ts` helper, OR
- Test it through the `SqliteCache` API directly: call `setLastSyncedAt()` to prime timestamps, then verify that a wrapper function (or a test-only entrypoint) skips or calls hydration accordingly.

Recommended approach: extract into `packages/server/src/hydration.ts`:
```typescript
export function shouldHydrate(lastSync: string | null, ttlMs: number = 60_000): boolean {
  const age = lastSync ? Date.now() - new Date(lastSync).getTime() : Infinity
  return age >= ttlMs
}
```
This is a pure function, trivially testable. The `index.ts` staleness guard becomes `if (shouldHydrate(lastSync))`.

Note: Extracting this helper is a one-line refactor in `index.ts` with zero behavior change. The test validates the extracted function directly.

---

## Tasks

- [ ] **Task 1: Export `shouldHydrate` helper and update `index.ts`** — Extract the staleness guard logic from `index.ts` into a pure exported function in a new `packages/server/src/hydration.ts` module.
  - Files:
    - Create: `packages/server/src/hydration.ts`
    - Modify: `packages/server/src/index.ts` (import and use `shouldHydrate`)
  - Tests: covered by Task 3 below
  - Depends on: nothing
  - Notes: Pure extraction — no logic change. `HYDRATION_TTL_MS = 60_000` remains in `index.ts` and is passed as `ttlMs` argument so tests can control it.

- [ ] **Task 2: Write `resolveProject()` tests** — Create the new test file with full coverage of the 4-strategy detection chain.
  - Files:
    - Create: `packages/server/src/__tests__/resolve-project.test.ts`
  - Tests: see test cases below
  - Depends on: nothing (can be written before Task 1 if staleness is a separate file)
  - Pre-mortem: If this task takes 3x longer, it will be because the `vi.mock('fs')` auto-mock fails to intercept `fs.existsSync` inside `config.ts` when using ESM — resolution is to switch to `vi.mock('node:fs')` or use `vi.spyOn(fsModule, 'existsSync')` instead of relying on the auto-mock.
  - Notes: Follow `startup.test.ts` conventions exactly: `import * as fsModule from 'fs'` before `vi.mock('fs')`, use `vi.mocked()` for typed access, restore all mocks in `afterEach` with `vi.restoreAllMocks()`.

- [ ] **Task 3: Write staleness guard tests** — Add tests for `shouldHydrate()` in a separate describe block (same file or a new file — see Notes).
  - Files:
    - Create OR append to: `packages/server/src/__tests__/resolve-project.test.ts` (second `describe` block), OR create `packages/server/src/__tests__/hydration.test.ts`
  - Tests: see test cases below
  - Depends on: Task 1 (the function must be exported first)
  - Notes: `hydration.ts` is a pure module — no mocking needed. Prefer a separate `hydration.test.ts` to keep `resolve-project.test.ts` focused on config logic.

---

## Detailed Test Cases

### File: `packages/server/src/__tests__/resolve-project.test.ts`

```
describe('resolveProject()')
  describe('Strategy 1 — .tages/config.json marker')
    ✓ returns marker match when marker exists and slug matches a registered project
    ✓ falls through to next strategy when marker file does not exist
    ✓ falls through when marker JSON is corrupt (SyntaxError from JSON.parse)
    ✓ falls through when marker slug does not match any registered project
    ✓ falls through when marker has no slug field

  describe('Strategy 2 — git remote URL match')
    ✓ returns git-remote match for HTTPS URL: https://github.com/owner/my-project.git
    ✓ returns git-remote match for SSH URL: git@github.com:owner/my-project.git
    ✓ returns git-remote match for HTTPS URL without .git suffix
    ✓ falls through when execSync throws (not a git repo)
    ✓ falls through when execSync times out (timeout error)
    ✓ falls through when remote URL yields a repo name with no registered match
    ✓ falls through when remote URL is malformed and extractRepoName returns null-ish

  describe('Strategy 3 — directory name match')
    ✓ returns dirname match when basename sanitizes to a registered slug
    ✓ falls through when sanitized dir name has no registered match
    ✓ sanitizeSlug: spaces become hyphens (e.g. "My Project" → "my-project")
    ✓ sanitizeSlug: special chars become hyphens (e.g. "project@v2.0" → "project-v2-0")
    ✓ sanitizeSlug: all-invalid chars fall back to "unnamed"
    ✓ sanitizeSlug: leading/trailing hyphens stripped

  describe('Strategy 4 — auto-create')
    describe('authenticated path')
      ✓ calls createCloudProject and saves config when auth.json is present and valid
      ✓ returns detectionMethod 'auto-create' on successful cloud create
      ✓ falls back to local project when createCloudProject throws tier limit error
      ✓ falls back to local project when createCloudProject throws generic error
      ✓ falls back to local project when auth.json exists but is corrupt JSON

    describe('unauthenticated path')
      ✓ calls createLocalProject when auth.json does not exist
      ✓ returns detectionMethod 'auto-create' for local project
      ✓ does not overwrite existing local config file when one already exists
      ✓ writes new local config file when none exists

describe('extractRepoName() via Strategy 2')
  (covered by Strategy 2 test cases above — no separate describe needed)

describe('sanitizeSlug() via Strategy 3')
  (covered by Strategy 3 test cases above — no separate describe needed)
```

### File: `packages/server/src/__tests__/hydration.test.ts`

```
describe('shouldHydrate()')
  ✓ returns true when lastSync is null (no prior sync)
  ✓ returns true when lastSync is older than 60s (e.g. 61 seconds ago)
  ✓ returns true when lastSync is exactly 60s ago (boundary: >= ttl)
  ✓ returns false when lastSync is 59s ago (cache is fresh)
  ✓ returns false when lastSync is 1ms ago (very fresh)
  ✓ accepts custom ttlMs override (e.g. 10s) — validates parametrization
  ✓ handles lastSync as ISO 8601 string correctly
```

---

## Mock Setup Reference

For `resolve-project.test.ts`, each test needs a controlled filesystem state. A `setupFs()` helper inside the test file should build the mock responses:

```typescript
function setupFs(opts: {
  markerExists?: boolean
  markerContent?: string           // raw JSON string or garbage
  registeredProjects?: ProjectConfig[]
  authExists?: boolean
  authContent?: string
}) {
  const projects = opts.registeredProjects ?? []

  vi.mocked(fsModule.existsSync).mockImplementation((p: fs.PathLike) => {
    const s = String(p)
    if (s.endsWith('/.tages/config.json')) return opts.markerExists ?? false
    if (s.endsWith('/auth.json')) return opts.authExists ?? false
    if (s.includes('/projects')) return projects.length > 0
    return false
  })

  vi.mocked(fsModule.readFileSync).mockImplementation((p: fs.PathLike | fs.PathOrFileDescriptor) => {
    const s = String(p)
    if (s.endsWith('/.tages/config.json')) return opts.markerContent ?? '{}'
    if (s.endsWith('/auth.json')) return opts.authContent ?? JSON.stringify({ accessToken: 'tok', refreshToken: 'ref', userId: 'uid' })
    return '{}'
  })

  vi.mocked(fsModule.readdirSync).mockImplementation(() =>
    projects.map(p => `${p.slug}.json`) as unknown as fs.Dirent[]
  )
}
```

Each `beforeEach` resets with `vi.resetAllMocks()`. Each `afterEach` calls `vi.restoreAllMocks()`.

For `createLocalProject`, always return a deterministic stub:
```typescript
vi.mocked(createLocalProject).mockReturnValue({ projectId: 'local-my-project', slug: 'my-project', supabaseUrl: '', supabaseAnonKey: '' })
```

For `createCloudProject`, return a resolved promise or throw:
```typescript
vi.mocked(createCloudProject).mockResolvedValue({ projectId: 'cloud-123', slug: 'my-project', supabaseUrl: '...', supabaseAnonKey: '...' })
// or for tier limit:
vi.mocked(createCloudProject).mockRejectedValue(new Error('Free tier is limited to 2 projects.'))
```

---

## File Ownership Matrix

| Task | Creates | Modifies |
|------|---------|----------|
| Task 1 — extract shouldHydrate | `packages/server/src/hydration.ts` | `packages/server/src/index.ts` |
| Task 2 — resolveProject tests | `packages/server/src/__tests__/resolve-project.test.ts` | — |
| Task 3 — staleness guard tests | `packages/server/src/__tests__/hydration.test.ts` | — |

No file conflicts between tasks.

---

## Open Questions

- [ ] **Should `sanitizeSlug` and `extractRepoName` be exported for direct unit testing?** — Blocks: Task 2. Default if unresolved: no, test indirectly through `resolveProject()`. If direct testing is wanted later, add `@internal` export without a public API change.

- [ ] **Should `shouldHydrate` live in `hydration.ts` or inline in `cache/sqlite.ts`?** — Blocks: Task 1 and Task 3. Default if unresolved: `packages/server/src/hydration.ts` (keeps concerns separate). Who: implementing developer.

---

## Definition of Done

- [ ] Code written and self-reviewed
- [ ] `packages/server/src/__tests__/resolve-project.test.ts` exists with all 4 strategy groups covered
- [ ] `packages/server/src/__tests__/hydration.test.ts` exists with all 7 staleness cases covered
- [ ] `pnpm --filter server test` passes with zero failures (existing 512 tests remain green)
- [ ] No real filesystem, network, or subprocess calls in any new test
- [ ] `shouldHydrate` extracted and `index.ts` updated (behavior unchanged)
- [ ] PR opened with coverage gaps noted in description
