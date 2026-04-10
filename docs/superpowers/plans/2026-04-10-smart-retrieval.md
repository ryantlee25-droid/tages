# Plan: Smart Retrieval Layer
_Created: 2026-04-10 | Type: New Feature_

## Goal

Upgrade `tages brief` from a full unranked memory dump to a scored, adaptive-budget, tiered-format context generator, and update the `session-context` skill to use a single `brief` call instead of four parallel tool calls.

## Background

The current `brief` implementation calls `cache.getAllForProject()`, groups memories by type, sorts each group by confidence alone, and injects everything into the token budget. For any real codebase with 100+ memories this easily exceeds 10K tokens and buries high-signal memories in noise. The `session-context` skill makes four parallel MCP calls (`recall` + `conventions` + `architecture` + `decisions`) with no coordination between them. Both problems are solved together: a composite scoring function, an adaptive token budget, and a tiered output format make `brief` the single authoritative context loader.

## Scope

**In scope:**
- New pure-function scorer at `packages/server/src/search/memory-scorer.ts`
- New `getAccessCounts(projectId)` method on `SqliteCache` in `packages/server/src/cache/sqlite.ts`
- Rewrite of `handleBrief` in `packages/server/src/tools/brief.ts` to use scoring, adaptive budget, and tiered formatting
- Update `skills/session-context/SKILL.md` to call `brief` once instead of four tools
- New vitest tests for scorer and updated brief behavior

**Out of scope:**
- The `recall` tool and `search/ranker.ts` — untouched
- `contextual_recall` — untouched
- The `Memory` interface in `packages/shared/src/types.ts` — not modified
- Token estimation formula (`chars / 4`) — unchanged
- Brief section priority ordering — unchanged
- Supabase-side access count tracking — scoring only reads the SQLite `access_count` column already maintained by `cache.recordAccess()`

## Technical Approach

### Scorer

A new file `packages/server/src/search/memory-scorer.ts` exports two functions:

- `scoreMemory(memory, accessCount, maxAccessCount) → number`
  - Formula: `confidence × 0.4 + recency × 0.3 + accessFrequency × 0.3`
  - Recency: `max(0, 1 - daysSinceUpdate / 90)` using `memory.updatedAt`
  - Access frequency: `accessCount / maxAccessCount` (returns 0 when `maxAccessCount === 0`)
- `scoreAndSort(memories, accessCounts) → ScoredMemory[]`
  - `accessCounts` is `Map<string, number>` keyed by memory id
  - Computes `maxAccessCount = Math.max(...accessCounts.values(), 0)`
  - Returns descending by score; stable tie-break by `updatedAt` descending then `id` lexicographic

`ScoredMemory` is a local interface `{ memory: Memory; score: number }`. Do not reuse `ScoredMemory` from `search/ranker.ts` — that interface carries `semanticScore` and `textScore` which are unrelated to this scorer.

Note: `search/ranker.ts` is shared infrastructure used by `recall`. Changes to the scorer must not touch ranker.ts.

### Cache

Add one method to `SqliteCache`:

```typescript
getAccessCounts(projectId: string): Map<string, number>
```

Single synchronous query: `SELECT id, access_count FROM memories WHERE project_id = ?`. Returns a `Map<string, number>`. Zero-results returns an empty map. No interface changes required — `better-sqlite3` is synchronous so no async plumbing needed.

### Brief

Changes to `handleBrief` in `packages/server/src/tools/brief.ts`:

1. **Rename parameter**: `args.budget` → `args.maxTokens` to match the spec language. Keep `budget` as local variable name internally for backwards compat if the caller uses the old name — accept both.

   Actually: the existing schema and callers use `budget`. Do not rename the external parameter. Keep `args.budget` to avoid breaking schema/callers. The adaptive logic changes the *default* only.

2. **Adaptive default budget**: Replace `const DEFAULT_BUDGET = 3000` with a function:
   ```typescript
   function adaptiveBudget(memoryCount: number): number {
     if (memoryCount < 50) return 4000
     if (memoryCount < 200) return 6000
     return 8000
   }
   ```
   Apply: `const budget = args.budget || adaptiveBudget(allMemories.length)`

3. **Scoring**: After `getAllForProject`, call `cache.getAccessCounts(projectId)` and pass both to `scoreAndSort`. Replace all per-group confidence sorts with `scoreAndSort` applied per group (extract the scored memories in order, discard the score wrapper for grouping).

   Implementation detail: call `scoreAndSort` once on `allMemories`, then group the results in the order they come out. Since `scoreAndSort` returns a flat sorted array, iterate it and bucket by type. This preserves global score ordering within each type group without a second sort.

4. **Tiered formatting**: For each section, split memories into top-tier and compact-tier:
   - `topCount = Math.max(3, Math.ceil(sectionItems.length * 0.2))`
   - `topTier = sectionItems.slice(0, topCount)`
   - `compactTier = sectionItems.slice(topCount)`
   - Top tier uses the existing section formatters unchanged
   - Compact tier rendered as a block at the end of the section:
     ```
     esm-cjs-import: createRequire + dir walk for ESM→CJS
     pkce-cli-auth: Use /auth/cli-token workaround for Supabase PKCE
     ```
     Each line: `${memory.key}: ${truncatedValue}` where `truncatedValue` = first 120 chars of `memory.value`, no trailing newline per entry.

5. **`appendIfBudget` stays unchanged** — it operates on the full pre-rendered section string.

### Session-Context Skill

Replace the four-tool parallel call block in `skills/session-context/SKILL.md` with a single `brief` call. The setup-path and empty-path handling below it remain unchanged. Update the happy-path summary line to reflect the count.

## Tasks

- [ ] **Task 1: Add `getAccessCounts` to SqliteCache** — add a single-query method that returns a `Map<string, number>` of all `access_count` values for a project.
  - Files: `packages/server/src/cache/sqlite.ts`
  - Tests: Extend `packages/server/src/__tests__/sqlite-cache.test.ts` — test that: (a) empty project returns empty map, (b) memories with known access counts are returned correctly keyed by id, (c) memories from a different project are not included.
  - Depends on: nothing
  - Notes: `better-sqlite3` is synchronous — use `this.db.prepare(...).all(projectId)` and construct the Map in a loop. The `access_count` column exists on all DBs via the upgrade path at line 135 of sqlite.ts.

- [ ] **Task 2: Create `memory-scorer.ts`** — pure scoring and sort functions with no external dependencies beyond the `Memory` type import from `@tages/shared`.
  - Files: `packages/server/src/search/memory-scorer.ts` (create)
  - Tests: Create `packages/server/src/__tests__/memory-scorer.test.ts` — cover:
    - `scoreMemory` formula: verify confidence, recency, and access frequency contribute correctly to the composite score
    - Recency boundary: memory updated 0 days ago scores 1.0 on recency, 90+ days scores 0
    - Access frequency: 0 when `maxAccessCount === 0`, correct ratio otherwise
    - `scoreAndSort`: descending order, stable tie-break, correct handling of empty input and all-zero access counts
  - Depends on: nothing
  - Notes: `ScoredMemory` interface is local to this file — do not import from `search/ranker.ts`. The scorer must work with `updatedAt` as an ISO string (parse with `new Date(memory.updatedAt).getTime()`).

- [ ] **Task 3: Rewrite `handleBrief` with adaptive budget, scoring, and tiered formatting** — wire the scorer and cache method into the brief handler; replace confidence-only sort; add tiered output per section.
  - Files: `packages/server/src/tools/brief.ts`
  - Tests: Create `packages/server/src/__tests__/brief.test.ts` — cover:
    - `adaptiveBudget`: correct tier selection for counts 0, 49, 50, 199, 200, 500
    - Tiered split: `topCount = max(3, ceil(n * 0.2))` verified for n=3, n=5, n=10, n=20
    - Compact format: key-value one-liner, value truncated at 120 chars
    - Full brief output: memories are ordered by composite score within each section (not just confidence)
    - Empty project case: unchanged "No memories stored" response
    - Budget respected: sections are dropped when token budget is exhausted (existing behavior)
    - Existing passing tests continue to pass
  - Depends on: Task 1 (getAccessCounts), Task 2 (scoreAndSort)
  - Pre-mortem: If this task takes 3x longer, it will be because the tiered formatter changes the string structure enough to break the `appendIfBudget` token estimates in subtle ways, or because the score-then-group ordering diverges from expectations in sections that combine multiple memory types (e.g., gotchas = `anti_pattern + lesson`). Mitigation: render the full section as a string and inspect token counts manually in tests before landing.
  - Notes: Keep `args.budget` as the external parameter name — do not change the Zod schema or callers. The adaptive default is only applied when `args.budget` is falsy.

- [ ] **Task 4: Update `session-context` skill** — replace the four-tool parallel call block with a single `brief` call; update summary line.
  - Files: `skills/session-context/SKILL.md`
  - Tests: No automated test — manual verification: confirm the skill text calls `brief` once and the happy-path summary says "Loaded N memories".
  - Depends on: Task 3 (brief must be correct before skill is updated)
  - Notes: The setup-path and empty-path handling in Step 2 remain unchanged. Only the tool call block in Step 1 and the happy-path summary line in Step 2 change.

## File Ownership Matrix

| Task | Creates | Modifies |
|------|---------|----------|
| Task 1 — getAccessCounts | — | `packages/server/src/cache/sqlite.ts`, `packages/server/src/__tests__/sqlite-cache.test.ts` |
| Task 2 — memory-scorer | `packages/server/src/search/memory-scorer.ts`, `packages/server/src/__tests__/memory-scorer.test.ts` | — |
| Task 3 — brief rewrite | `packages/server/src/__tests__/brief.test.ts` | `packages/server/src/tools/brief.ts` |
| Task 4 — skill update | — | `skills/session-context/SKILL.md` |

No file conflicts. Tasks 1 and 2 are independent of each other and can run in parallel. Task 3 depends on Tasks 1 and 2. Task 4 depends on Task 3.

## Open Questions

- [ ] **Does the Zod schema for `brief` need a `maxTokens` alias?** — Blocks: Task 3. Default if unresolved: keep `budget` as the sole parameter name, no alias added. Who: Ryan.

## Definition of Done

- [ ] Code written and self-reviewed
- [ ] `getAccessCounts` covered by sqlite-cache tests, empty project and cross-project isolation verified
- [ ] `memory-scorer.ts` covered by unit tests: all three score components exercised, edge cases covered (zero max, 90-day boundary)
- [ ] `brief.test.ts` covers adaptive budget tiers, tiered split counts, compact format truncation, score ordering, and budget enforcement
- [ ] All existing 521 vitest tests pass (`pnpm test`)
- [ ] `pnpm typecheck` passes with no new errors
- [ ] PR opened; coverage gaps noted in description
