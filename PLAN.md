# Plan: Close the Quality Gaps — Warm Agent 8.25 → 9.5+
_Created: 2026-04-04 | Type: New Feature (multiple enhancements)_

## Goal

Close the six reviewer-identified gaps that prevent the warm agent from consistently scoring 9.5+/10, by adding an `execution` memory type, structured metadata fields, an example memory system, a cross-system relationship graph, a confidence verification gate for auto-extracted memories, and a richer recall output format.

## Background

A/B testing shows the warm agent scores 8.80 (docgen) to 9.70 (feature implementation) vs 7.01 and 2.80 cold. Independent blind review by ChatGPT and Gemini identified seven specific gaps. The gains are unevenly distributed: convention compliance is near-perfect, but execution flows, conditional logic, cross-system compositions, and concrete examples are absent from the memory store entirely. Those gaps are what pull the docgen score below 9.5. This plan addresses each gap with a targeted schema or tool change.

## Scope

**In scope:**
- New `execution` memory type for step-by-step pipelines and event flows
- Structured metadata: `conditions`, `preconditions`, `phases` fields on `Memory`
- `examples` field on `Memory` for concrete input/output scenarios
- `cross_system_refs` field for tracking which memory keys a given memory interacts with
- Confidence gate: auto-extracted memories below 0.75 go to a pending queue, not live recall
- Richer recall output: show `conditions`, `examples`, and `cross_system_refs` when present
- Supabase migration for all schema changes
- SQLite cache updates to match
- Shared type updates in `packages/shared/src/types.ts`
- README update with new memory type and field documentation

**Out of scope:**
- Changing the existing search algorithm (trigram + pgvector is proven; don't break 100% hit rate)
- Rewriting existing memories stored by users (new fields are optional/nullable; old memories are unaffected)
- Dashboard UI for the pending queue (CLI + MCP tools only in this plan)
- LLM-powered auto-population of `conditions` or `examples` fields (agent-driven for now)

## Technical Approach

All seven gaps map to either a schema change (gaps 1, 2, 3, 4, 5) or a behavior change (gaps 6, 7). The approach is additive: new fields are optional on `Memory`, nullable in the DB, and old memories continue to work unchanged.

**Gap-to-task mapping:**
- Gap 1 (no execution memories) → add `execution` to `MemoryType` enum + `execution_flow` structured fields
- Gap 2 (coarse conditional logic) → add `conditions: string[]` and `phases: string[]` fields to `Memory`
- Gap 3 (cross-system interactions) → add `cross_system_refs: string[]` field (keys of related memories)
- Gap 4 (no examples) → add `examples: Array<{input: string, output: string, note?: string}>` field
- Gap 5 (event-driven not captured) → the `execution` type with `trigger` and `steps` covers this — no separate type needed
- Gap 6 (hallucination from recall) → increase specificity in recall output: surface `conditions`, `examples`, and `cross_system_refs` inline rather than just `key` + `value`
- Gap 7 (observe confidence too low) → pending queue: auto-extracted memories with confidence < 0.75 stored with `status: 'pending'`; excluded from recall until verified

**Key files touched:**
- `packages/shared/src/types.ts` — `Memory` type, `MemoryType` enum
- `packages/server/src/schemas.ts` — `RememberSchema` zod definition
- `packages/server/src/tools/remember.ts` — store new fields
- `packages/server/src/tools/recall.ts` — surface new fields in output
- `packages/server/src/tools/observe.ts` — pending queue routing for low-confidence auto-extracts
- `packages/server/src/tools/session-end.ts` — same confidence gate as observe
- `packages/server/src/cache/sqlite.ts` — SQLite schema additions, query updates
- `supabase/migrations/0013_execution_and_metadata.sql` — all Postgres changes

## Open Questions

- [ ] Should `cross_system_refs` be denormalized keys (strings) or actual foreign key UUIDs? Strings are simpler and survive memory renames, but can go stale. Recommend strings for now — add a `validate_refs` RPC in a future migration if needed.
- [ ] Should verified pending memories get a confidence bump to 1.0 or retain their original auto-extracted confidence? Recommend: retain original + add a `verified_at` timestamp so the agent can signal "this was human-confirmed."
- [ ] The `examples` field JSONB array — max how many? Recommend 5 as a soft convention (no DB constraint) to keep recall output scannable.

---

## Tasks

### T1 — Extend shared types (S)

Add `execution` to `MemoryType`. Add optional fields `conditions`, `phases`, `cross_system_refs`, `examples`, and `executionFlow` to the `Memory` interface. Add `ExecutionFlow` and `MemoryExample` sub-types. Add `status: 'live' | 'pending'` field for the confidence gate.

**Files:**
- `packages/shared/src/types.ts`

**Changes:**
```
MemoryType: add 'execution'
Memory: add
  conditions?: string[]
  phases?: string[]
  cross_system_refs?: string[]
  examples?: MemoryExample[]
  executionFlow?: ExecutionFlow
  status?: 'live' | 'pending'

new type MemoryExample = { input: string; output: string; note?: string }
new type ExecutionFlow = {
  trigger: string
  steps: string[]
  conditions?: string[]
  eventHooks?: string[]
}
```

**Tests:** Update type tests in `packages/shared/src/__tests__/` to assert new fields are present in the interface and that `MemoryType` includes `'execution'`. Ensure old fields still compile without new optional fields.

**Effort: S**

---

### T2 — Supabase migration: execution type + metadata fields (M)

Write migration `0013_execution_and_metadata.sql`. Changes:
- Add `'execution'` to the `type` check constraint on `memories` (requires dropping and recreating the constraint)
- Add columns: `conditions text[] default '{}'`, `phases text[] default '{}'`, `cross_system_refs text[] default '{}'`, `examples jsonb default '[]'`, `execution_flow jsonb`, `status text not null default 'live' check (status in ('live', 'pending'))`
- Add index: `memories_status_idx on memories(project_id, status)` (for pending queue queries)
- Update `hybrid_recall` and `importance_recall` RPCs to filter `status = 'live'` by default (add optional `p_include_pending bool default false` param)
- Add `pending_memories` RPC that returns `status = 'pending'` memories for a project, ordered by confidence desc

**Files:**
- `supabase/migrations/0013_execution_and_metadata.sql`

**Tests:** Run migration on a test Supabase instance. Verify that existing memories retain their values and that recall RPCs exclude pending memories by default.

**Effort: M**

---

### T3 — SQLite cache: add new columns + update queries (M)

Extend `SqliteCache` to store and retrieve the new fields.

**Files:**
- `packages/server/src/cache/sqlite.ts`

**Changes:**
- Add columns to `SCHEMA` string: `conditions TEXT DEFAULT '[]'`, `phases TEXT DEFAULT '[]'`, `cross_system_refs TEXT DEFAULT '[]'`, `examples TEXT DEFAULT '[]'`, `execution_flow TEXT`, `status TEXT NOT NULL DEFAULT 'live'`
- Add `ALTER TABLE ... ADD COLUMN` upgrade stubs (same pattern as existing `embedding` upgrade at line 44)
- Update `upsertMemory` to serialize/deserialize the new fields
- Update `rowToMemory` to deserialize the new fields
- Add `getPendingMemories(projectId)` method — returns memories with `status = 'pending'`
- Update `queryMemories` and `semanticQuery` to filter `status = 'live'` by default, with an optional `includePending` param
- Add index: `CREATE INDEX IF NOT EXISTS memories_status ON memories(project_id, status)`

**Tests:** Add tests in `packages/server/src/__tests__/` covering:
- Round-trip storage of `conditions`, `examples`, and `executionFlow` through `upsertMemory`
- `queryMemories` excludes pending memories by default
- `getPendingMemories` returns only pending
- Upgrade path: existing DB without new columns doesn't crash (ALTER TABLE guard)

**Effort: M**
**Depends on:** T1

---

### T4 — Update `RememberSchema` and `remember` tool to accept new fields (S)

Extend the `remember` MCP tool so agents can explicitly set `conditions`, `phases`, `cross_system_refs`, `examples`, and `executionFlow` when storing a memory.

**Files:**
- `packages/server/src/schemas.ts`
- `packages/server/src/tools/remember.ts`

**Changes to `schemas.ts`:**
- Add to `RememberSchema`:
  ```
  conditions: z.array(z.string()).optional()
  phases: z.array(z.string()).optional()
  cross_system_refs: z.array(z.string()).optional()
  examples: z.array(z.object({ input: z.string(), output: z.string(), note: z.string().optional() })).optional()
  executionFlow: z.object({ trigger: z.string(), steps: z.array(z.string()), conditions: z.array(z.string()).optional(), eventHooks: z.array(z.string()).optional() }).optional()
  ```

**Changes to `remember.ts`:**
- Pass new fields through to the `Memory` object in `handleRemember`
- New memories always have `status: 'live'` (explicit remember is always trusted)
- Pass new fields to `cache.upsertMemory` and `sync.remoteInsert`

**Tests:** Add a test that stores a memory with `executionFlow` and verifies all fields round-trip correctly through `handleRemember`.

**Effort: S**
**Depends on:** T1, T3

---

### T5 — Confidence gate in `observe` and `session-end` tools (S)

Auto-extracted memories with `confidence < 0.75` are stored with `status: 'pending'` and excluded from recall until verified. Above 0.75, use `status: 'live'` (current behavior).

**Files:**
- `packages/server/src/tools/observe.ts`
- `packages/server/src/tools/session-end.ts`

**Changes to `observe.ts`:**
- Current confidence is hard-coded at `0.7` (line 88). Set memories with `confidence < 0.75` to `status: 'pending'`
- Update the returned message to indicate when a memory went to pending: `"Queued for review: \"key\" (confidence 0.70 — below threshold). Use verify_memory to promote."`

**Changes to `session-end.ts`:**
- Same gate: `confidence < 0.75` → `status: 'pending'`
- Session end currently uses `confidence: 0.8` (line 72), which is above the gate — no functional change there, but add the gate check for future-proofing
- Update the summary to note how many went to pending vs live

**Tests:**
- `observe` with a pattern-matching phrase stores memory as `status: 'pending'` when confidence is 0.7
- `observe` with same phrase, confidence bumped to 0.8, stores as `status: 'live'`
- `session-end` extraction below threshold routes to pending

**Effort: S**
**Depends on:** T3

---

### T6 — New `verify_memory` MCP tool (S)

Allows an agent or user to promote a pending memory to live (after human review).

**Files:**
- `packages/server/src/tools/verify-memory.ts` (new file)
- `packages/server/src/schemas.ts` (add `VerifyMemorySchema`)
- `packages/server/src/index.ts` (register the new tool)

**Tool behavior:**
```
Input: { key: string }
Action: set status = 'live' on memory with matching key
Output: "Verified: \"key\" is now live."
Also: set confidence to max(existing_confidence, 0.85) to signal human-confirmed
```

**Tests:**
- Verify promotes pending → live
- Verify on a key that doesn't exist returns clear error
- Verify on a key that is already live is a no-op (returns "already live")

**Effort: S**
**Depends on:** T3, T4

---

### T7 — Add `pending_memories` tool to surface the review queue (S)

Agents and users need a way to see what's queued for verification.

**Files:**
- `packages/server/src/tools/pending.ts` (new file)
- `packages/server/src/schemas.ts` (add `PendingSchema = z.object({})`)
- `packages/server/src/index.ts` (register the tool)

**Tool behavior:**
- Calls `cache.getPendingMemories(projectId)` and remote equivalent
- Returns a formatted list sorted by confidence (lowest first, since those most need review)
- Output format mirrors `conventions.ts` and `decisions.ts` for consistency

**Tests:** Store two pending memories, call `pending_memories`, verify both appear and are sorted by confidence.

**Effort: S**
**Depends on:** T3, T6

---

### T8 — Richer recall output: surface conditions, examples, cross_system_refs (S)

The `recall` tool currently outputs only `key`, `value`, `filePaths`, and `tags`. When a memory has `conditions`, `examples`, or `cross_system_refs`, surface them inline. This directly addresses Gap 6 (recall too abstract, enabling hallucination).

**Files:**
- `packages/server/src/tools/recall.ts`

**Changes to `formatResults`:**
- After `value`, if `conditions` is non-empty: `   When: condition1, condition2`
- If `phases` is non-empty: `   During: phase1, phase2`
- If `executionFlow` present: `   Flow: [trigger] → step1 → step2 → ...`
- If `examples` non-empty: show first example as `   Example: input → output`
- If `cross_system_refs` non-empty: `   Interacts with: key1, key2`
- All additions are conditional on field existence — no change to output for memories without new fields

**Tests:**
- Memory with `conditions: ['when bleeding']` surfaces "When: when bleeding" in recall output
- Memory with `examples` shows first example
- Memory with `cross_system_refs` surfaces the ref keys
- Memory without any new fields produces identical output to current behavior

**Effort: S**
**Depends on:** T1, T4

---

### T9 — Add `execution` type to `MemoryTypeSchema` validation path and CLI (S)

The `MemoryTypeSchema` in `schemas.ts` gates the `type` field. The CLI `remember` command and its help text need to acknowledge `execution`. Also update the README memory type table.

**Files:**
- `packages/server/src/schemas.ts` — add `'execution'` to `MemoryTypeSchema` enum
- `packages/cli/src/` — wherever memory type is listed in help text or tab-completion
- `README.md` — add `execution` row to the "What It Tracks" table with an example

**Note:** `MemoryTypeSchema` is already imported from `packages/server` — check that `packages/cli` doesn't have its own copy of the enum.

**Tests:** Calling `handleRemember` with `type: 'execution'` does not throw a Zod validation error.

**Effort: S**
**Depends on:** T1, T2

---

### T10 — Integration test: end-to-end execution memory round-trip (S)

Covers the full path that a real agent would take when storing and recalling execution flow memories.

**Files:**
- `packages/server/src/__tests__/execution-memory.test.ts` (new file)

**Test scenarios:**
1. Store an `execution` memory with `executionFlow`, `conditions`, and `examples` via `handleRemember`
2. Recall it with a query that matches the trigger
3. Assert the output string includes the flow steps, conditions, and first example
4. Store a second memory with `cross_system_refs` pointing to the first memory's key
5. Recall the second memory and assert `cross_system_refs` are shown

**Effort: S**
**Depends on:** T4, T6, T8

---

### T11 — Pre-MR pipeline

1. `code-reviewer` — resolve any blockers
2. `test-runner` — fix failures; note coverage gaps (particularly pending queue edge cases)
3. `git-agent` — open MR

---

## Definition of Done

Every task in this plan is complete when:
- [ ] Code written and self-reviewed
- [ ] Tests written or updated for the changed logic
- [ ] `code-reviewer` passes with no blockers
- [ ] `test-runner` passes with no failures
- [ ] MR opened via `git-agent` with coverage gaps (if any) noted in the description

---

## Gap Closure Map

| Reviewer Gap | Root Cause (code-level) | Tasks That Close It |
|---|---|---|
| Gap 1: No execution pipeline memories | `MemoryType` has no `execution` variant; no `executionFlow` field | T1, T2, T3, T4, T9 |
| Gap 2: Conditional logic too coarse | `Memory.value` is a flat string; no `conditions` or `phases` fields | T1, T2, T3, T4, T8 |
| Gap 3: Cross-system interactions missing | No way to link a memory to related memory keys | T1, T2, T3, T4, T8 |
| Gap 4: No concrete examples | No `examples` field on `Memory` | T1, T2, T3, T4, T8 |
| Gap 5: Event-driven architecture not captured | Covered by `execution` type + `executionFlow.eventHooks` | T1, T2, T3, T4, T9 |
| Gap 6: Recall too abstract → hallucination | `formatResults` only shows `value`; conditions/examples not surfaced | T8 |
| Gap 7: Auto-extract confidence too low | `observe` stores at 0.7 confidence with no gate | T5, T6, T7 |

---

## References

- Gap analysis source: ChatGPT + Gemini blind review of warm agent output
- A/B test baseline: `/Users/ryan/projects/tages/test-ab/scorecard.md` (9.70/10 warm, 2.80/10 cold)
- Docgen benchmark: `/Users/ryan/projects/tages/test-ab/docgen/test1-scores.md` (8.80/10 warm)
- Current `MemoryType` enum: `packages/shared/src/types.ts` line 5
- Current `Memory` interface: `packages/shared/src/types.ts` line 20
- `observe` confidence constant: `packages/server/src/tools/observe.ts` line 88
- `session-end` confidence constant: `packages/server/src/tools/session-end.ts` line 72
- SQLite schema: `packages/server/src/cache/sqlite.ts` lines 4–33
- Postgres schema: `supabase/migrations/0001_initial_schema.sql`
- Hybrid recall RPC: `supabase/migrations/0008_pgvector.sql`
- Importance recall RPC: `supabase/migrations/0009_importance_scoring.sql`
