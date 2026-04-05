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

---

# Plan: Smarter Agents — Intelligence Upgrades for White, Gray, Orange, Brown, Blue
_Created: 2026-04-05 | Type: Refactor_

## Goal

Upgrade five Spectrum Protocol agent definitions to produce higher-quality output at their core competencies — fewer false positives in code review, smarter test diagnosis, faster root cause identification, genuinely useful retrospective lessons, and plans that anticipate problems before they happen.

## Background

The five agents (White, Gray, Orange, Brown, Blue) were recently cleaned up for token efficiency. Structure is now tight. The next improvement is intelligence: each agent should be substantively better at its primary job after this plan, drawing on proven techniques from production AI code review systems (CodeRabbit, Datadog SAST), test intelligence research (Meta's mutation-guided generation, Qodo TestGPT), multi-agent debugging frameworks (TraceCoder, FVDebug/NVIDIA), retrospective AI at scale (Zalando's postmortem pipeline), and planning research (Sweep AI's search-expand-verify decomposition).

## Scope

**In scope:**
- Prompt/instruction changes to `~/.claude/agents/whites.md`
- Prompt/instruction changes to `~/.claude/agents/grays.md`
- Prompt/instruction changes to `~/.claude/agents/oranges.md`
- Prompt/instruction changes to `~/.claude/agents/browns.md`
- Prompt/instruction changes to `~/.claude/agents/blues.md`

**Out of scope:**
- Changes to Gold, Copper, Obsidian, Howlers, or other agents not listed
- Infrastructure changes (no new files, no hooks, no tooling)
- Model reassignments (White/Gray/Orange/Blue stay Sonnet; Brown stays Haiku)
- Changes to how agents are invoked or orchestrated

## Technical Approach

Each agent file is a standalone Markdown prompt definition at `~/.claude/agents/<name>.md`. Changes are prompt additions and restructurings — no code required. Each task below targets one agent, explains the specific techniques to add, and why each mechanism makes the agent smarter.

---

## Tasks

---

### T1 — Upgrade White (Code Reviewer) with context-engineering and suspicion scoring

**Agent file:** `~/.claude/agents/whites.md`

**What to add:**

**1. Pre-review intent extraction (from CodeRabbit's context-engineering approach)**

Before analyzing the diff, White should extract the stated intent of the change. Currently White jumps straight to the diff. CodeRabbit packs a 1:1 ratio of code-to-context in their prompts, sourcing intent from PR title, commit messages, and linked issues. White should do the same — at the start of Step 2 (Understand Context), add:

```
Intent extraction: Read git log --oneline to get commit messages. If a PR description
is available (via environment), read it. Summarize in one sentence: "This change aims to ___."
Use this intent throughout review — a finding is more likely to be a BLOCKER if it directly
contradicts the stated intent, and more likely to be noise if it's unrelated to the change's purpose.
```

**Mechanism**: Findings anchored to stated intent have dramatically lower false positive rates. Datadog's LLM-based SAST filter works the same way — it reasons about whether "conditions for exploitation are actually met" given the surrounding code context. Reviewing intent first gives White the same grounding filter.

**2. Suspicion scoring with for-and-against prompting (from FVDebug's Graph Scanner)**

FVDebug achieves 95.6% hypothesis quality by requiring each hypothesis to have explicit for-and-against evidence before scoring. Apply this to White's Step 4 (Self-Verify). Instead of a single confidence score per BLOCKER, require White to explicitly state:

```
For each BLOCKER before finalizing:
  - Evidence FOR this being a real bug: [specific line or pattern]
  - Evidence AGAINST (could be intentional, handled elsewhere, unreachable): [specific line or comment]
  - Confidence 1-5: only keep as BLOCKER if >= 3 AND evidence-for outweighs evidence-against
```

**Mechanism**: The for-and-against framing prevents the LLM from committing to a hypothesis based on one-sided pattern matching. This is what separates CodeRabbit's agentic verification layer from naive diff review.

**3. Learning integration (from CodeRabbit's learnable feedback loop)**

CodeRabbit stores project-specific learnings from developer feedback and injects them on future reviews. White already checks LESSONS.md (Orange does), but White does not. Add to Step 2:

```
Check ~/.claude/projects/*/memory/LESSONS.md if it exists. Scan for any entries tagged
"false positive", "review noise", or "intentional pattern". Downgrade findings that match
known-intentional patterns to SUGGESTION or skip entirely.
```

**Mechanism**: Without memory, White repeats the same false positives run-over-run. With it, review quality compounds with each spectrum.

**4. Architectural blast radius annotation**

For BLOCKER findings, add a one-line annotation: "Callers affected: [N] call sites found via grep". This is drawn from CodeRabbit's Code Graph Analysis which builds dependency graphs to understand architectural impact. White doesn't need a full graph — a quick grep for the changed function name gives the callsite count.

**Files:** `~/.claude/agents/whites.md`

**Tests:** No automated tests — validate by running White on a branch with known false positives and confirming the rate drops. Document before/after in a note in this plan.

**Depends on:** Nothing.

**Effort: S**

---

### T2 — Upgrade Gray (Test Runner) with mutation-awareness and failure triage

**Agent file:** `~/.claude/agents/grays.md`

**What to add:**

**1. Weak test detection via assertion quality scoring (from Meta's mutation-guided generation research)**

Meta's ACH tool and the MuTAP paper show that LLMs can identify "equivalent mutants" — code changes that should be caught by tests but aren't. Gray currently reports coverage percentages but says nothing about test quality. Add a weak test detector to the coverage gap analysis:

```
Weak test heuristics — flag these in coverage gap analysis:
- Test files where every assertion is assertEqual(result, True) or toBeTruthy() — no
  specific value checked. Flag as: "Weak assertions — tests pass but won't catch wrong values."
- Test functions with zero assertions (only checking that code doesn't throw).
  Flag as: "Smoke test only — no behavioral contract."
- Tests that mock every dependency (nothing real is being tested). Flag as:
  "Fully mocked — covers execution path, not logic."
Report these under a new "## WEAK TESTS" section in Standard/Deep mode.
```

**Mechanism**: Coverage percentage is a false comfort signal. A 90% covered file with only `toBeTruthy()` assertions will not catch a logic regression. Gray should distinguish between "covered" and "tested."

**2. Failure classification with triage priority (from TraceCoder's Historical Lesson Learning Mechanism)**

TraceCoder's HLLM distills lessons from prior failed repair attempts to guide subsequent repairs. Gray's Deep mode already gives "likely cause" but doesn't prioritize which failure to fix first. Add a triage section:

```
In Deep mode, after listing all failures, add:
── TRIAGE ORDER ────────────────────────────────────
Fix in this order:
1. [failure name] — Root cause: [one word: assertion|mock|environment|logic|type]
   Fix cost: [low|medium|high] | Blocks: [N other failing tests if shared root cause]
2. ...

Root cause taxonomy:
- assertion: test expectation is wrong (test needs updating, not code)
- mock: missing or incorrect mock setup
- environment: external dependency, port, or env var issue
- logic: implementation is wrong
- type: TypeScript/Python type mismatch
```

**Mechanism**: Without triage order, developers fix the first failure they see, which is often an environment issue (hardest, lowest leverage) rather than the single logic bug causing 8 cascading failures. The taxonomy also tells the developer whether to fix the test or fix the code.

**3. Change-aware test selection explanation (from Datadog's Test Impact Analysis)**

Gray's Step 2 already does affected-only re-runs. Improve it by explaining which tests were selected and why:

```
When running in re-run mode (--changed or --onlyChanged), output before running:
"Running N tests affected by changes to: [list of changed files]
Skipping M tests (no dependency on changed files)."
This makes the selection auditable — if a test that should be affected was skipped,
the developer can catch it.
```

**Mechanism**: Blind affected-only runs create silent gaps. Showing the selection reasoning makes it auditable and catches dependency map errors.

**Files:** `~/.claude/agents/grays.md`

**Tests:** No automated tests — validate by running Gray on a project with known weak assertions and confirming the WEAK TESTS section fires correctly.

**Depends on:** Nothing.

**Effort: S**

---

### T3 — Upgrade Orange (Root Cause Debugger) with causal graph reasoning and runtime trace injection

**Agent file:** `~/.claude/agents/oranges.md`

**What to add:**

**1. Causal chain construction before hypotheses (from FVDebug's Causal Graph Synthesis)**

FVDebug's key contribution is structuring failure traces into directed graphs before analysis — this prevents jumping to the nearest symptom rather than the true cause. Orange's Phase 3 currently generates up to 3 hypotheses directly. Add a causal chain step between Phase 2 (Understand) and Phase 3 (Diagnose):

```
Before forming hypotheses, construct a causal chain:

Causal chain (trace backwards from the symptom):
  Symptom: [what the error message says]
    ← Immediate cause: [what code produced this error]
      ← Enabling condition: [what state/input made it possible]
        ← Root decision: [where in the code this path was chosen]

Write this chain explicitly before hypothesizing. Hypotheses should address
the root decision level, not the symptom or immediate cause level.
```

**Mechanism**: FVDebug achieves 95.6% hypothesis quality (vs much lower for direct LLM analysis) by forcing causal structure before speculation. Without this step, LLMs consistently fix the symptom and leave the root cause in place, producing regressions.

**2. For-and-against evidence framing per hypothesis (from FVDebug's Graph Scanner with batched LLM analysis)**

FVDebug's Graph Scanner uses "for-and-against prompting" to identify suspicious nodes. Orange already has a hypothesis budget of 3 but doesn't require symmetric evidence. Update Phase 3's hypothesis format to require both sides:

The existing format already has "Evidence FOR" and "Evidence AGAINST" — this is good. Strengthen it by requiring Orange to actively search for disconfirming evidence rather than just noting absence of it:

```
Evidence AGAINST: Actively search for this. Check:
- Is there a null check or guard we missed?
- Is there a test that covers this path and passes? (if so, why?)
- Is there a comment explaining why this pattern is intentional?
If you cannot find disconfirming evidence after actively looking, that strengthens
the hypothesis — state that explicitly.
```

**Mechanism**: Passive "evidence against" allows the LLM to say "none found" without looking. Active disconfirmation search produces genuinely stronger hypotheses and catches cases where a bug has a complementary guard elsewhere.

**3. Historical lesson lookup before Phase 1 (from TraceCoder's HLLM and existing Orange behavior)**

Orange already checks LESSONS.md before diagnosing. Strengthen this step to be more specific:

```
Before Phase 1, check LESSONS.md Known Failure Patterns. For each matching pattern:
- State the match explicitly: "Pattern match: [pattern name] — this bug may be [description]"
- If the pattern has a known fix, present it as Hypothesis 0 (before the 3-hypothesis budget)
- Hypothesis 0 costs nothing against the 3-hypothesis budget — it's a free lookup
```

**Mechanism**: TraceCoder's HLLM shows that learning from prior repair attempts (their term: "distilled insights") reduces redundant repair attempts and improves Pass@1 rate. Making the LESSONS.md match a free "Hypothesis 0" creates a direct incentive to write high-quality patterns in Brown's output.

**4. Spectrum-based fault localization scoring for multi-file bugs (from SBFL research)**

SBFL computes suspiciousness scores by correlating which files/functions appear in failing-but-not-passing test executions. Orange can approximate this without instrumentation:

```
For Type B (Failing Test) bugs where multiple files could be implicated:
After Phase 1, before Phase 2, list implicated files with informal suspicion ranking:
  High suspicion: [files changed in recent commits that touch the failing test's domain]
  Medium suspicion: [files the failing test imports directly]
  Low suspicion: [transitive dependencies]
Read Phase 2 in high-suspicion order. Stop when you find the bug.
```

**Mechanism**: SBFL's key insight is that code touched only by failing tests (not passing ones) is more likely to be the fault. Orange's approximation — recency + direct import — captures 80% of this signal without runtime instrumentation.

**Files:** `~/.claude/agents/oranges.md`

**Tests:** No automated tests — validate by running Orange on a known multi-cause bug and confirming the causal chain step prevents a symptom-level fix.

**Depends on:** Nothing.

**Effort: M**

---

### T4 — Upgrade Brown (Retrospective Agent) with map-fold synthesis and lesson quality gates

**Agent file:** `~/.claude/agents/browns.md`

**What to add:**

**1. Map-fold synthesis pipeline (from Zalando's multi-stage LLM postmortem pipeline)**

Zalando's AI postmortem system uses a map-fold pattern: independently process each document to extract relevant information (map phase), then aggregate outputs into a higher-level summary via a second LLM pass (fold phase). Brown currently reads all artifacts and synthesizes in one pass. Split this explicitly:

```
Step 5 (extraction) is the MAP phase: extract raw findings per Howler without synthesis.
Add a new Step 5b (FOLD phase) before writing LESSONS.md:

Step 5b: Cross-Howler synthesis
After extracting all per-Howler findings, answer these questions across the full set:
1. Which error appeared in 2+ Howlers? (pattern candidate)
2. Which contract assumption was violated by any Howler? (seam risk)
3. Which Howler took longest / had the most revision cycles? (sizing signal)
4. Was there a "first domino" — one early error that caused 2+ downstream delays?

Write answers to these 4 questions in the scratch file before writing LESSONS.md.
These answers are the source material for "Known Failure Patterns."
```

**Mechanism**: Zalando found that single-pass LLM analysis produces "surface attribution errors" (blaming the nearest cause, not the systemic one). The map-fold separation forces Brown to look at the full picture before writing patterns, not pattern-match during reading.

**2. Platitude detector for lesson quality (from the actionable/specific/novel rubric — strengthen it)**

Brown's existing rubric has 3 checks (actionable, specific, novel). Add a fourth check that catches generic advice before it gets written:

```
4. Non-platitude check: Before writing any lesson, ask: "Would this lesson appear in a
   generic software engineering blog post?" If yes, it's a platitude — rewrite with
   specific details from this run or drop it.

   Platitude examples (do not write these):
   - "Better communication between Howlers would help"
   - "More thorough testing is recommended"
   - "Ensure contract is clear before starting"

   Rewrite as specifics:
   - "Howler-auth and Howler-db both assumed RLS policies would be set — neither checked.
     Add an explicit RLS verification step to CONTRACT.md for any Howler touching Supabase."
```

**Mechanism**: Platitudes don't change behavior. The non-platitude check is drawn from post-mortem quality research (Atlassian, incident.io) which shows that the most common failure of incident retrospectives is lessons that sound insightful but produce no action change.

**3. Systemic pattern promotion with recurrence tracking**

Add a lightweight recurrence counter to Known Failure Patterns:

```
When writing a Known Failure Pattern that matches a pattern already in LESSONS.md
from a prior run, update the existing entry instead of creating a new one:
  - Increment a recurrence count: "Recurrence: N"
  - Add the rain-id of the new occurrence
  - Update the description if the new instance reveals a more precise prevention

This turns one-time failures into tracked recurring risks.
```

**Mechanism**: Zalando's 2-year postmortem analysis found that AI detection of "hidden hotspots" (recurring systemic issues) is the highest-value output. A pattern that recurs 3 times is far more important than a novel one-off — the recurrence count makes this visible to Gold.

**Files:** `~/.claude/agents/browns.md`

**Tests:** No automated tests.

**Depends on:** Nothing.

**Effort: S**

---

### T5 — Upgrade Blue (Work Planner) with risk-first decomposition and dependency pre-mortem

**Agent file:** `~/.claude/agents/blues.md`

**What to add:**

**1. Search-expand-verify context building (from Sweep AI's planning approach)**

Sweep AI's planning blog describes a graph traversal approach: start with searched files as root nodes, expand by one degree (direct imports/importers), use an LLM to verify which expanded nodes are actually relevant. Blue's Step 1 currently stops at "read files directly related to the work." Add one expansion step:

```
After reading directly related files (Step 1), do one expansion pass:
For each file you read, identify its direct imports and the files that import it
(one grep each). From this expanded set, read only those that:
  a) Are imported by 3+ of the files you already read (high centrality — likely shared utility)
  b) Have names suggesting shared interfaces (types.ts, schema.ts, middleware.ts, base.ts)

This gives you the "hidden shared dependencies" that most plans miss. Flag any of these
in the plan with: "Note: [file] is shared infrastructure — changes here affect [N] other modules."
```

**Mechanism**: Sweep found that naive file-based context has high recall but low precision. The expand-then-filter step adds precision without requiring a full dependency graph. The most common planning failure — missing a shared type file that breaks 3 other modules — is caught by this step.

**2. Pre-mortem for each task (from risk-aware decomposition research and Addy Osmani's spec-driven workflow)**

Osmani's spec-driven development framework requires validating each phase before moving to the next. Blue currently flags risks as open questions. Add a structured pre-mortem per task:

```
For each task with effort M or L, add a Pre-mortem field:
  Pre-mortem: "If this task fails or takes 3x longer, it will be because: [most likely reason]"

Common pre-mortem answers to check for:
- "The shared type file has a different shape than expected"
- "The existing tests are brittle and will need updating for any logic change"
- "This file is also modified by [other task] — file ownership conflict risk"
- "The migration is irreversible — test on a branch before merging"

A task with a pre-mortem answer of "I don't know" should be downgraded to a Spike task
first: "Spike: Read [X] to confirm approach before implementing."
```

**Mechanism**: Pre-mortems are a well-established forcing function for surfacing hidden assumptions before commitment. Applied to task planning, they turn vague unease into specific blockers — the same thing Politico does for Spectrum contracts, but at the individual task level.

**3. File ownership conflict detection (from the Spectrum file ownership rule)**

Blue already has a file ownership matrix for Spectrum-aware sizing. Add it as a default check for all multi-task plans, not just Spectrum ones:

```
For any plan with 3+ tasks, after writing all tasks, run this check:
  File conflict scan: list every file under "Files:" across all tasks.
  If any file appears under two tasks, flag it:
  "⚠ File conflict: [file] appears in Task A and Task B.
   Resolution options: (1) Make them sequential, (2) Assign file to one task and add
   a note in the other to import the result, (3) Extract the shared change to a new task."

Never write a plan with an unresolved file conflict.
```

**Mechanism**: File conflicts are the #1 cause of merge failures in Spectrum runs. The check is mechanical — it just requires looking at the "Files:" lines across all tasks — but Blue currently doesn't do it for non-Spectrum plans.

**4. Effort calibration with task type multipliers**

Blue's self-evaluation table (Step 5) checks scope, files, tests, and dependencies — but not effort accuracy. Add effort sanity checks:

```
Effort calibration multipliers (apply during Step 5 self-evaluation):
  Base: S = half-day, M = full day, L = 2 days
  Multiply by 1.5x if:
  - Task requires a database migration (irreversibility adds coordination cost)
  - Task touches auth or security code (review and testing overhead)
  - Task's pre-mortem answer mentions "I don't know" (uncertainty tax)
  Round up to next size. If a task becomes XL (>2 days), split it.
```

**Mechanism**: LLM planners systematically underestimate tasks involving migrations, auth, and uncertainty — the same failure modes that cause Howler revision cycles to exhaust. Explicit multipliers counteract this.

**Files:** `~/.claude/agents/blues.md`

**Tests:** No automated tests — validate by running Blue on a real task description and confirming the pre-mortem and file conflict check appear in the output.

**Depends on:** Nothing.

**Effort: M**

---

## Open Questions

- [ ] Should White's LESSONS.md lookup be scoped to the current project only, or all projects? Default: current project only (avoids cross-project false positive suppression). Blocks: T1.
- [ ] Brown's recurrence tracking requires reading prior LESSONS.md entries to find matches. This adds reading cost on every run. Is that acceptable for Haiku? Default: yes — one file read. Blocks: T4.

---

## Definition of Done

Every task in this plan is complete when:
- [ ] Agent definition updated with the specific techniques described
- [ ] Output of the agent is qualitatively better on a test case (documented manually)
- [ ] No new false positives introduced (White) or no new missed failures (Gray)
- [ ] PR opened via Copper with changes to the five agent files

---

## References

- CodeRabbit context engineering blog: https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews
- CodeRabbit accurate reviews on massive codebases: https://www.coderabbit.ai/blog/how-coderabbit-delivers-accurate-ai-code-reviews-on-massive-codebases
- Datadog LLM false positive filtering: https://www.datadoghq.com/blog/using-llms-to-filter-out-false-positives/
- FVDebug (NVIDIA): https://arxiv.org/abs/2510.15906
- TraceCoder multi-agent debugging: https://arxiv.org/abs/2602.06875
- Meta mutation-guided test generation (FSE 2025): https://arxiv.org/abs/2501.12862
- Zalando AI postmortem analysis: https://engineering.zalando.com/posts/2025/09/dead-ends-or-data-goldmines-ai-powered-postmortem-analysis.html
- Sweep AI planning blog: https://github.com/sweepai/sweep/blob/main/docs/pages/blogs/ai-code-planning.mdx
- SBFL overview: https://slicefl.github.io/home/sbfl/
- Addy Osmani on AI code review: https://addyo.substack.com/p/code-review-in-the-age-of-ai
- Qodo TestGPT: https://www.qodo.ai/resources/testgpt-a-generative-ai-tool-that-guarantees-code-integrity/
- Datadog Test Impact Analysis: https://www.datadoghq.com/blog/streamline-ci-testing-with-datadog-intelligent-test-runner/

---

# Plan: Dashboard v2 — Memory Intelligence Suite
_Created: 2026-04-05 | Type: New Feature_

## Goal

Extend the Tages dashboard, CLI, and MCP server with 8 capabilities that surface memory intelligence — pending queue management, execution flow visualization, analytics, export API, CLI verification commands, nav wiring, table enhancements, and a detailed stats MCP tool.

## Background

The core memory store (W1) is stable. This suite promotes the dashboard from a read-only memory viewer into an active memory management tool: agents can write pending memories, humans review and verify them, execution flows are visualized, and project health stats are surfaced across all surfaces (dashboard, CLI, MCP).

## Scope

**In scope:**
- Pending queue dashboard page with verify/reject and Realtime
- Execution flow viewer dashboard page (renders `ExecutionFlow.trigger/steps` from `Memory.executionFlow`)
- Stats dashboard page (type counts, confidence distribution, top agents)
- Authenticated REST export endpoint (`GET /api/projects/[projectId]/export?format=json|markdown`)
- CLI `tages pending` and `tages verify <key>` commands
- `ProjectNav` tabs extended: Pending, Execution, Stats; command-palette wired into project layout
- `MemoryTable` enhancements: execution type filter tab, status filter (live/pending), inline verify/reject buttons
- MCP `stats_detail` tool returning per-type breakdowns, confidence histogram, and top-agent rankings

**Out of scope:**
- Bulk import via dashboard UI
- Stats persistence / time-series trending
- Mobile-specific layouts beyond what inherits from existing responsive patterns
- New Supabase migrations (all required columns — `status`, `execution_flow`, `confidence` — already exist per migration history)

## Technical Approach

**Dashboard pages** follow the existing RSC shell + client component pattern established in `decisions/page.tsx` and `activity/page.tsx`: a Server Component at `app/app/projects/[slug]/<route>/page.tsx` fetches `project` via `@/lib/supabase/server`, passes `project.id` to a `'use client'` component that owns its own Supabase subscription.

**Route API auth** follows the pattern in `apps/dashboard/src/app/api/stripe/checkout/route.ts`: call `createClient()` from `@/lib/supabase/server`, check `supabase.auth.getUser()`, return 401 on no user. The export endpoint additionally validates that the requesting user owns the project by joining against `projects.owner_id`.

**`ProjectNav`** is a pure Server Component in `apps/dashboard/src/components/project-nav.tsx`. Adding tabs is a straightforward extension to the `TABS` array. The `CommandPalette` component (`apps/dashboard/src/components/command-palette.tsx`) is already built but not wired into any layout — it gets added to the project layout shell.

**CLI commands** follow the pattern in `packages/cli/src/commands/recall.ts`: `loadProjectConfig()` helper, `createSupabaseClient()` from `@tages/shared`, chalk + ora for output. New commands register in `packages/cli/src/index.ts`.

**MCP `stats_detail` tool** extends `packages/server/src/tools/stats.ts`, which already accesses `cache.getAllForProject()` and optionally calls `sync.supabase.rpc('project_usage_stats', ...)`. The new tool adds a confidence histogram bucket and per-agent breakdown using the same local cache.

**Shared `MemoryTable` enhancements** are self-contained in `apps/dashboard/src/components/memory-table.tsx` — adding a `statusFilter` state alongside the existing `filter` (type) state, appending `execution` to `MEMORY_TYPES`, and conditionally rendering verify/reject action buttons inside the row.

## Open Questions

- [ ] Should verify/reject in the dashboard call a Route Handler (to match CLI/MCP) or call Supabase directly from the client (consistent with existing `MemoryRowDetail` pattern)? ⚠️ Assume direct Supabase client for now — matches existing delete/update pattern in `memory-row-detail.tsx`.
- [ ] Export endpoint: Bearer token auth (for CI use) or session-cookie only? ⚠️ Assume session-cookie only for v1 — bearer token support is a follow-up (CLI already has its own export command).

---

## File Ownership Matrix

| File | Task | Op |
|---|---|---|
| `apps/dashboard/src/app/app/projects/[slug]/pending/page.tsx` | T1 | CREATES |
| `apps/dashboard/src/components/pending-queue.tsx` | T1 | CREATES |
| `apps/dashboard/src/app/app/projects/[slug]/execution/page.tsx` | T2 | CREATES |
| `apps/dashboard/src/components/execution-flow-viewer.tsx` | T2 | CREATES |
| `apps/dashboard/src/app/app/projects/[slug]/stats/page.tsx` | T3 | CREATES |
| `apps/dashboard/src/components/stats-dashboard.tsx` | T3 | CREATES |
| `apps/dashboard/src/app/api/projects/[projectId]/export/route.ts` | T4 | CREATES |
| `packages/cli/src/commands/pending.ts` | T5 | CREATES |
| `packages/cli/src/index.ts` | T5 | MODIFIES |
| `apps/dashboard/src/components/project-nav.tsx` | T6 | MODIFIES |
| `apps/dashboard/src/app/app/projects/[slug]/layout.tsx` | T6 | CREATES |
| `apps/dashboard/src/components/memory-table.tsx` | T7 | MODIFIES |
| `packages/server/src/tools/stats-detail.ts` | T8 | CREATES |
| `packages/server/src/index.ts` | T8 | MODIFIES |

**File ownership is exclusive — no two tasks touch the same file.**

---

## Tasks

- [ ] **T1 — Pending Queue Page** — Build the pending memory review page with real-time updates and verify/reject actions.

  **CREATES:**
  - `apps/dashboard/src/app/app/projects/[slug]/pending/page.tsx` — RSC shell; fetches project by slug using `@/lib/supabase/server` (same shape as `decisions/page.tsx`); passes `project.id` and `project.name` to `PendingQueue`.
  - `apps/dashboard/src/components/pending-queue.tsx` — `'use client'` component. Loads memories where `status = 'pending'` via `supabase.from('memories').select('*').eq('project_id', projectId).eq('status', 'pending').order('created_at', {ascending: false})`. Sets up a Realtime subscription on the `memories` table filtered to `project_id` (same channel pattern as `memory-table.tsx` lines 37-51). Each row renders the `TypeBadge`, key, value preview, confidence %, agent name, and two action buttons: **Verify** (updates `status = 'live'`, sets `verified_at = now()`) and **Reject** (deletes the row). Both actions call `supabase` directly from the client (consistent with `memory-row-detail.tsx`). Optimistic UI: remove row immediately on action, restore on error. Empty state matches pattern in `memory-table.tsx` lines 123-130.

  **Tests:** Verify component renders pending memories; verify/reject buttons call Supabase with correct payload; Realtime channel is subscribed on mount and unsubscribed on unmount.

  **Notes:** `status` and `verified_at` columns exist in Supabase (see migration `0013_execution_and_metadata.sql`). No migration needed.

- [ ] **T2 — Execution Flow Viewer** — Build the execution memory visualization page.

  **CREATES:**
  - `apps/dashboard/src/app/app/projects/[slug]/execution/page.tsx` — RSC shell matching `decisions/page.tsx` shape; passes `project.id` to `ExecutionFlowViewer`.
  - `apps/dashboard/src/components/execution-flow-viewer.tsx` — `'use client'` component. Queries `memories` where `type = 'execution'` and `status = 'live'`. For each memory, renders a flow card: trigger badge at top (brand `#3BA3C7`), then a vertical step list with connector lines (reuse the timeline dot+line pattern from `decision-timeline.tsx` lines 76-83). Optionally render `phases` and `hooks` arrays from `executionFlow` if present. Clicking a card opens a `MemoryRowDetail` detail sheet for editing (reuse existing component). Search input filters by key/trigger text client-side.

  **Tests:** Flow cards render correctly with trigger and steps; empty state shown when no execution memories exist; clicking a card opens `MemoryRowDetail`; search filters the list.

  **Notes:** `ExecutionFlow` type is already defined in `packages/shared/src/types.ts` (lines 29-34). The `execution_flow` column is a `jsonb` column in Postgres — the Supabase client returns it as a parsed object. Cast with `(memory.execution_flow as ExecutionFlow)`.

- [ ] **T3 — Stats Dashboard** — Build the project memory analytics page.

  **CREATES:**
  - `apps/dashboard/src/app/app/projects/[slug]/stats/page.tsx` — RSC shell; passes `project.id` to `StatsDashboard`.
  - `apps/dashboard/src/components/stats-dashboard.tsx` — `'use client'` component. On mount, runs three Supabase queries in parallel via `Promise.all`:
    1. Count by type: `select('type').eq('project_id', projectId)` then group client-side.
    2. Confidence distribution: same dataset — bucket into `[0-0.5)`, `[0.5-0.75)`, `[0.75-0.9)`, `[0.9-1.0]` client-side.
    3. Top agents: `select('agent_name').eq('project_id', projectId)` — count per non-null `agent_name`.
    Also calls `supabase.rpc('project_usage_stats', { p_project_id: projectId })` to get session/recall hit rate stats (same call already in `packages/server/src/tools/stats.ts` lines 23-27).
    Layout: three stat cards at top (total memories, pending count, recall hit rate), then a type breakdown table with colored `TypeBadge` rows and bar-graph-style width indicators (CSS `width` set to percentage, no external chart library), then confidence buckets, then top agents list.

  **Tests:** Renders with mock Supabase data; type breakdown shows correct counts; confidence buckets sum to total; top agents excludes null agent names.

  **Notes:** No chart library — use CSS width bars consistent with existing Tailwind patterns. `project_usage_stats` RPC already exists per `stats.ts`.

- [ ] **T4 — Memory Export API** — Authenticated REST endpoint to export project memories.

  **CREATES:**
  - `apps/dashboard/src/app/api/projects/[projectId]/export/route.ts` — `GET` handler. Auth: `await createClient()` then `supabase.auth.getUser()` — return 401 if no user (matches `checkout/route.ts` pattern). Authorization: verify `project.owner_id = user.id` via `supabase.from('projects').select('owner_id').eq('id', projectId).single()` — return 403 if mismatch. Query: `supabase.from('memories').select('*').eq('project_id', projectId).eq('status', 'live').order('type').order('updated_at', {ascending: false})`. Format negotiation via `?format=json` (default) or `?format=markdown`. JSON response: `Content-Type: application/json`, body is the raw array. Markdown response: `Content-Type: text/markdown`, `Content-Disposition: attachment; filename="tages-memories.md"` — build the same CLAUDE.md format already implemented in `packages/cli/src/commands/export.ts` lines 70-150 (extract the formatting logic, do not duplicate it).

  **Tests:** Returns 401 for unauthenticated request; returns 403 for authenticated user who doesn't own the project; returns JSON array for `?format=json`; returns markdown with correct headers for `?format=markdown`; only returns `status = 'live'` memories.

  **Notes:** The markdown formatting logic in `export.ts` is pure string manipulation — copy it into a shared helper at `apps/dashboard/src/lib/export-formatter.ts` rather than duplicating. ⚠️ Flag this as a potential seam: T4 CREATES `export-formatter.ts`, no other task touches it.

- [ ] **T5 — CLI `pending` and `verify` commands** — Add two new CLI subcommands for queue management from the terminal.

  **CREATES:**
  - `packages/cli/src/commands/pending.ts` — Two exported functions: `pendingCommand(options)` and `verifyCommand(key, options)`.
    - `pendingCommand`: loads config (same `loadProjectConfig` pattern from `recall.ts` lines 133-144), creates Supabase client, queries `memories` where `status = 'pending'` ordered by `created_at desc`, prints table with chalk: `[type]` colored via `getTypeColor()` (copy from `recall.ts`), key in bold, confidence %, agent name dimmed. Prints count header with `chalk.bold`. Empty: `chalk.dim('No pending memories.')`.
    - `verifyCommand(key)`: loads config, queries for `key`, checks `status === 'pending'` (prints warning if already live), sets `status = 'live'` and `verified_at = now()` via Supabase update, prints confirmation with `chalk.green`.

  **MODIFIES:**
  - `packages/cli/src/index.ts` — Register two new commands: `tages pending` (options: `-p, --project <slug>`) and `tages verify <key>` (options: `-p, --project <slug>`). Add imports for `pendingCommand` and `verifyCommand` at the top. Follow existing command registration style.

  **Tests:** `pendingCommand` prints pending memories in correct format; `verifyCommand` updates `status` and `verified_at`; `verifyCommand` prints warning for already-live memory; config-not-found error path handled.

  **Notes:** Reuse `getTypeColor()` from `recall.ts` — extract to `packages/cli/src/commands/utils.ts` if it doesn't already exist. Check first; avoid duplicating.

- [ ] **T6 — Project Nav Update + Command Palette Wiring** — Extend `ProjectNav` with new tabs and wire `CommandPalette` into the project-level layout.

  **MODIFIES:**
  - `apps/dashboard/src/components/project-nav.tsx` — Add 5 new entries to the `TABS` array: `{ key: 'pending', label: 'Pending', href: '/pending' }`, `{ key: 'execution', label: 'Execution', href: '/execution' }`, `{ key: 'stats', label: 'Stats', href: '/stats' }`. Keep existing 4 tabs (memories, decisions, activity, settings). Order: Memories, Pending, Execution, Stats, Decisions, Activity, Settings.

  **CREATES:**
  - `apps/dashboard/src/app/app/projects/[slug]/layout.tsx` — Server Component layout wrapping all project sub-routes. Fetches project by slug (same pattern as `page.tsx`). Renders `CommandPalette` as a client component overlay (it manages its own open/close state via `Cmd+K` listener). The `onSelect` callback navigates to the memory's detail by setting a URL search param or opening `MemoryRowDetail`. Since `CommandPalette` requires `projectId` and is client-only, wrap it in a thin `'use client'` provider or pass `projectId` as a prop from a small client wrapper. Keep the RSC layout itself as a Server Component by extracting the palette into a `CommandPaletteWrapper` client component that receives `projectId`.

  **Tests:** All 7 tab links render with correct `href`; active tab gets `border-[#3BA3C7]` class; `CommandPalette` renders in layout and opens on Cmd+K; `CommandPalette` receives a valid `projectId`.

  **Notes:** `CommandPalette.onSelect` currently accepts a `Memory` and calls a parent callback — for the layout context, `onSelect` can open a global memory detail sheet or navigate to the memory's page. Keep the `onSelect` signature generic; a no-op or `console.log` is acceptable for v1 if the wiring is complex. The key deliverable is the palette being keyboard-accessible from all project sub-pages.

- [ ] **T7 — Memory Table Enhancements** — Add execution type filter, status filter, and inline verify/reject actions to the existing memory table.

  **MODIFIES:**
  - `apps/dashboard/src/components/memory-table.tsx` — Three additions:
    1. **Execution type tab**: append `'execution'` to the `MEMORY_TYPES` array (line 22). Add `execution` to `TypeBadge`'s `TYPE_COLORS` in `type-badge.tsx` — use `bg-teal-500/10 text-teal-400 border-teal-500/20`.
    2. **Status filter**: add a `statusFilter` state (`'all' | 'live' | 'pending'`, default `'all'`). Render a second filter row below the type tabs with three buttons styled identically to the type tabs. When `statusFilter !== 'all'`, add `.eq('status', statusFilter)` to the Supabase query in `loadMemories()`. The `search` path (RPC `recall_memories`) is live-only by convention — leave unchanged, only apply status filter to the non-search query path.
    3. **Inline verify/reject**: when a row's `memory.status === 'pending'`, render two small action buttons inline in the row (right-aligned, before the date): a green "Verify" tick button and a red "Reject" X button. Clicking either calls Supabase directly (same as `PendingQueue` in T1) and calls `loadMemories()` to refresh. Stop propagation to prevent opening `MemoryRowDetail`.

  **Tests:** `execution` tab filters to type=execution; status filter applies `.eq('status', ...)` to query; pending rows show verify/reject buttons; live rows do not show those buttons; clicking verify updates status; click stops propagation.

  **Notes:** `type-badge.tsx` is owned by T7 (MODIFIES). No other task modifies it. The `execution` color should match the brand teal (`#3BA3C7` family) — `teal-400` is the closest Tailwind approximation.

- [ ] **T8 — Server `stats_detail` MCP Tool** — Add a new MCP tool that returns a detailed analytics payload from the SQLite cache.

  **CREATES:**
  - `packages/server/src/tools/stats-detail.ts` — Exports `handleStatsDetail(projectId, cache, sync)`. Implementation:
    - Calls `cache.getAllForProject(projectId)` to get all memories.
    - Computes: (a) count by type, sorted desc; (b) confidence histogram in 5 buckets: `[0,0.5)`, `[0.5,0.7)`, `[0.7,0.85)`, `[0.85,0.95)`, `[0.95,1.0]`; (c) top agents sorted by memory count, max 10, excluding null/undefined; (d) pending count and pending-by-type breakdown; (e) execution memory count and a list of trigger names from `executionFlow.trigger` where `type === 'execution'`.
    - Optionally fetches `project_usage_stats` RPC if `sync` is present (same try/catch pattern as `stats.ts` lines 21-29).
    - Returns structured JSON in the `content[0].text` field, formatted as human-readable markdown sections (consistent with `stats.ts` output style).

  **MODIFIES:**
  - `packages/server/src/index.ts` — Import `handleStatsDetail` from `./tools/stats-detail`. Register the tool with the MCP server: name `stats_detail`, description `"Detailed memory analytics: type breakdown, confidence histogram, top agents, pending queue, and execution trigger inventory."`, input schema `{ project: z.string().optional() }`. Wire to `handleStatsDetail(projectId, cache, sync)`.

  **Tests:** Returns correct type counts; confidence histogram buckets are mutually exclusive and exhaustive; pending count matches cache; execution triggers extracted correctly; handles empty cache gracefully.

  **Notes:** `handleStatsDetail` is a pure function over the cache — no network calls except the optional Supabase RPC. Keep it side-effect-free so it's easy to unit test. The existing `handleStats` tool is **not modified** — `stats_detail` is additive.

- [ ] **Pre-MR pipeline**
  1. `code-reviewer` — resolve any blockers
  2. `test-runner` — fix failures; note coverage gaps
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

## References
- `apps/dashboard/src/components/memory-table.tsx` — primary feature component
- `apps/dashboard/src/components/project-nav.tsx` — nav tab pattern
- `apps/dashboard/src/app/app/layout.tsx` — authenticated app shell
- `apps/dashboard/src/app/app/projects/[slug]/decisions/page.tsx` — RSC page shell pattern
- `apps/dashboard/src/components/decision-timeline.tsx` — timeline visual pattern
- `packages/cli/src/commands/recall.ts` — CLI command pattern (loadProjectConfig, chalk output)
- `packages/cli/src/commands/export.ts` — markdown export formatting logic
- `packages/server/src/tools/stats.ts` — MCP tool pattern
- `packages/server/src/tools/verify.ts` — verify/pending MCP handlers
- `packages/shared/src/types.ts` — Memory, ExecutionFlow, MemoryStatus types
- `apps/dashboard/src/app/api/stripe/checkout/route.ts` — Route Handler auth pattern
- Supabase migration `0013_execution_and_metadata.sql` — execution_flow and status columns

---

---

# Plan: Make Spectrum Competitive With Single-Agent Execution
_Created: 2026-04-05 | Type: Refactor_

## Goal

Close the 4.6x cost and 4.6x speed penalty that Spectrum incurred versus raw single-agent execution in the benchmark run, by eliminating the Howler read-loop failure, reducing per-Howler context-loading tax, and adding a data-driven mode selector that steers small jobs away from Spectrum entirely.

## Background

An 8-task benchmark showed Spectrum losing on every metric: 397k vs 86k tokens (4.6x), 101 vs 22 minutes (4.6x), 6/8 vs 8/8 completion (25% failure rate). Two Howlers (T1, T2) spent their entire budgets reading files and never wrote a line of code. Even if completion were 100%, the quality gates (White, Gray, Orange) that were improved earlier in the session were never stress-tested because Howlers must complete before gates can run. All four fixes target the root causes identified from that benchmark run.

## Scope

**In scope:**
- `~/.claude/agents/howlers.md` — hard phase gates forcing transition from reading to writing
- `~/.claude/HOWLER-OPS.md` — same phase gate rules in the Howler operating manual
- `~/.claude/SPECTRUM-OPS.md` — upgraded per-Howler Codebase Context format for CONTRACT.md
- `~/.claude/agents/golds.md` — effort-based mode routing table with sequential-vs-Spectrum math

**Out of scope:**
- Changes to quality gate agents (White, Gray, Orange) — improved separately
- Changes to the Tages project source code
- New agent types or new phases in the Spectrum lifecycle
- Changes to SPECTRUM.md (canonical spec) — all changes go to the operational files only; SPECTRUM.md syncs in a follow-on task if desired

## Technical Approach

All four changes are text edits to agent definition files and ops manuals in `~/.claude/`. No code to compile, no tests to run — "done" means the text is in place and self-consistent. The phase gate (Fix 1) must be consistent between `howlers.md` and `HOWLER-OPS.md` since both are injected into Howler drop prompts in different contexts. The Codebase Context format change (Fix 2) lives only in `SPECTRUM-OPS.md` (the authoritative format reference) and the guidance must be strong enough that Gold produces it without needing reminders in `golds.md`. The mode routing changes (Fix 3 and 4) both land in `golds.md` since that is Gold's authoritative operational reference; SPECTRUM-OPS.md already delegates mode selection to Gold.

## Open Questions

- [ ] Should the effort-estimation formula (Fix 4) use wall-clock minutes or relative multipliers? Recommendation: wall-clock (S=30min, M=2hr, L=4hr) so Gold can compare apples-to-apples without further interpretation.

---

## Tasks

- [ ] **Fix 1 — Add hard phase gates to Howler agent definition and ops manual**

  Two Howlers spent their entire budgets in Phase 1 (reading) and never entered Phase 2 (writing). The fix is an explicit, numbered phase structure with a hard call-count cap on Phase 1 — with a STOP instruction that is impossible to miss.

  **Files:**
  - `~/.claude/agents/howlers.md` — add Phase Gate section to Core Protocol
  - `~/.claude/HOWLER-OPS.md` — add the same Phase Gate as a named section before "Your Workflow"

  **Changes to make:**

  In `~/.claude/agents/howlers.md`, replace the `## Core Protocol` section with:

  ```markdown
  ## Phase Gates (enforce strictly)

  ### Phase 1 — Orient (hard cap: 10 tool calls)
  Read CONTRACT.md and your drop prompt. Read at most 5 reference files beyond CONTRACT.md.
  Write HOOK.md. That is all Phase 1 contains.
  - If you reach 10 tool calls and have not yet written a single output file: **STOP reading. Start writing immediately with what you have.**
  - You will never have complete information. Incomplete information is normal. Write anyway.

  ### Phase 2 — Implement (all remaining budget)
  Every tool call must produce output: Write, Edit, or Bash (to run a command).
  Read and Grep calls are only permitted to resolve a specific blocker in a file you are actively writing.
  - Allowed: reading a function signature to match an interface you are implementing
  - Not allowed: exploratory reading to understand the codebase generally

  ## Core Protocol

  1. **Read your assignment** from the drop prompt (task scope, files owned, branch name, spectrum ID)
  2. **Read CONTRACT.md** in the spectrum directory — shared types, interfaces, naming conventions, postconditions
  3. **Read at most 5 reference files** listed in your Codebase Context section of CONTRACT.md
  4. **Create HOOK.md** in the spectrum directory immediately — this is your crash-recovery state
  5. **Implement** within your file-ownership boundaries only (Phase 2 starts here)
  6. **Update HOOK.md** as you complete milestones (checked-off work, errors encountered, seam declarations)
  7. **Write to your debrief** in the spectrum directory: assumptions made, seams declared, integration notes
  ```

  In `~/.claude/HOWLER-OPS.md`, insert the following block immediately before `## Your Workflow (Steps 1-12)`:

  ```markdown
  ## Phase Gates (enforce before starting work)

  ### Phase 1 — Orient (hard cap: 10 tool calls total)
  - Read your drop prompt
  - Read CONTRACT.md
  - Read at most 5 reference files from your Codebase Context section
  - Write HOOK.md

  **If you hit 10 tool calls without writing a single output file: STOP reading. Start writing now.**
  CONTRACT.md's Codebase Context section was written by Gold specifically so you do not need to read the underlying files yourself. Trust it and write.

  ### Phase 2 — Implement (all remaining budget)
  Every tool call must produce output. Read/Grep calls are only permitted to resolve a specific, named blocker in a file you are actively writing.

  Not permitted in Phase 2:
  - Reading files to understand the codebase generally
  - Grepping to discover patterns you could infer from CONTRACT.md
  - Re-reading files you already read in Phase 1
  ```

  **Why this fixes the problem:** The benchmark Howlers never had an instruction telling them to STOP reading and start writing. They had scope alignment checks (every 20 tool calls) but no hard cap on Phase 1. A Howler that reads 10 files and then reads 10 more has no forcing function under the current rules. The phase gate creates one.

  **Tests:** Manual review — verify the phase gate text appears identically in both files, verify the "10 tool calls" cap is stated explicitly, verify Phase 2 explicitly bans exploratory reads.

- [ ] **Fix 2 — Upgrade per-Howler Codebase Context format in SPECTRUM-OPS.md**

  Each Howler currently re-reads the same codebase files that Gold already read during muster, paying 20-30k tokens each for context Gold already has. The fix is to make the Codebase Context section in CONTRACT.md rich enough that Howlers do not need to re-read the underlying files at all.

  **Files:**
  - `~/.claude/SPECTRUM-OPS.md` — upgrade the per-Howler Codebase Context instructions in Phase 1 step 10

  **Current text to replace** (search for `## Codebase Context` guidance in step 10):

  > Per-Howler `## Codebase Context` section: Gold reads each file in the Howler's MODIFIES list and summarizes existing function signatures relevant to the task, patterns in use (e.g., "uses factory pattern", "all exports are named, not default"), and any gotchas observed ... Keep summaries to 5–15 lines per file.

  **Replace with:**

  ```markdown
  Per-Howler `## Codebase Context` section: Gold MUST make this section self-contained enough that
  the Howler can begin writing without opening any file in the MODIFIES list. Howlers that re-read
  files Gold already summarized are wasting 20-30k tokens of their budget. Write as if the Howler
  cannot read the file — because it should not need to.

  Required content per MODIFIES file (10-25 lines per file):
  - **All exported function/class/type signatures** with parameter names and types
  - **The 2-3 most important patterns in the file** (e.g., "every tool handler follows
    `async function handleX(input: z.infer<typeof schema>, cache: MemoryCache): Promise<ToolResult>`")
  - **Gotchas that will cause a build failure** if not followed (e.g., "this file has a circular
    import with X — avoid touching the import block"; "all exports must be named, not default")
  - **The exact import path** Howler should use to consume this file from other files they own

  Additionally, write a `### Quick Reference` block per Howler at the end of their Codebase Context
  section. This is a 3-5 bullet cheat sheet of the patterns the Howler will use most. Example:

  ```markdown
  ### Quick Reference — howler-tools
  - New tool handler: `async function handleX(input: z.infer<typeof XInputSchema>, cache: MemoryCache): Promise<ToolResult>`
  - Register in `index.ts`: `server.tool('tool_name', XInputSchema, (args) => handleX(args, cache))`
  - Return shape: `{ content: [{ type: 'text', text: markdown_string }] }`
  - Cache read: `cache.getMemories(projectId)` — returns `Memory[]`, never throws
  - Shared types live in `@tages/shared` — import, never redefine
  ```

  For Howlers with no MODIFIES files (all CREATES): write a `## Codebase Context` section that
  documents the import paths and patterns from adjacent files the Howler must match, even though
  it does not own them.
  ```

  **Why this fixes the problem:** Gold already reads every MODIFIES file during muster to write the codebase context. The current 5-15 line limit produces summaries too thin to work from. Increasing the target to 10-25 lines per file plus a Quick Reference section means the Howler gets a self-contained reference rather than a stub that forces them to go back to the source.

  **Tests:** Manual review — verify the 5-15 line limit is replaced with 10-25 lines, verify the "self-contained enough that the Howler can begin writing without opening any file" instruction is present, verify the Quick Reference format block is included.

- [ ] **Fix 3 — Add effort-based mode routing to Gold agent definition**

  Spectrum currently activates at 3+ tasks regardless of task size. The benchmark run had 8 tasks that each took 1-2 hours — far too small for Spectrum overhead (~8 min muster + ~5 min quality gates × 8 Howlers = 48+ min of pure overhead) to be worth it. Gold needs a rule that routes small jobs to sequential execution.

  **Files:**
  - `~/.claude/agents/golds.md` — replace the `## Mode Selection` table

  **Current table:**

  ```markdown
  | Criteria | Mode | Muster Time |
  |----------|------|-------------|
  | 2-3 Howlers, all CREATE, no shared interfaces, obvious boundaries | **Nano** | <1 min |
  | 3-4 Howlers, all CREATE, no shared interfaces | **Reaping** | ~3 min |
  | Everything else (MODIFIES, shared types, complex deps) | **Full** | ~8 min |
  ```

  **Replace with:**

  ```markdown
  ## Mode Selection (decide in under 30 seconds)

  ### Step 1 — Check task size first

  Before choosing a Spectrum mode, calculate whether Spectrum will save time:

  - **Sequential time**: sum all task efforts (S = 30 min, M = 2 hr, L = 4 hr)
  - **Spectrum time**: max(individual task efforts) + muster overhead + quality gate overhead
    - Nano muster: 1 min | Reaping muster: 3 min | Full muster: 8 min
    - Quality gate per Howler: ~5 min (White + Gray + diff-review in parallel)
    - Formula: `max_effort + muster_time + (5 min × howler_count)`

  **Spectrum is worth it when** `spectrum_time < sequential_time × 0.7`.

  If Spectrum is NOT worth it, present to the human:
  > "These [N] tasks would take approximately [X] min sequentially vs [Y] min in Spectrum
  > (including muster and quality gate overhead). Sequential is faster here. Use Spectrum anyway?"

  Default to sequential unless the human explicitly confirms Spectrum.

  ### Step 2 — If using Spectrum, choose the lightest mode that fits

  | Criteria | Mode | Muster Time |
  |----------|------|-------------|
  | 2-3 Howlers, all CREATE, no shared interfaces, obvious boundaries | **Nano** | <1 min |
  | 3-4 Howlers, all CREATE, no shared interfaces | **Reaping** | ~3 min |
  | Everything else (MODIFIES, shared types, complex deps) | **Full** | ~8 min |

  Default to the lightest mode that fits. Upgrade if a Howler blocks.
  ```

  **Why this fixes the problem:** The benchmark had 8 tasks × ~1 hr each = ~8 hr sequential. Spectrum time = max(1 hr) + 8 min + (5 min × 8) = 1 hr 48 min. Spectrum wins clearly there. But for 8 tasks × S-effort (30 min each): sequential = 4 hr, Spectrum = 30 min + 8 min + 40 min = 78 min. Spectrum still wins. For 5 tasks × S (2.5 hr sequential) vs Spectrum (30 + 3 + 25 = 58 min), Spectrum wins by a smaller margin. The formula makes this calculation explicit instead of leaving it to Gold's intuition.

  **Tests:** Manual review — verify the effort lookup table (S=30 min, M=2 hr, L=4 hr) is present, verify the formula is stated, verify the human-confirmation prompt text is present.

- [ ] **Fix 4 — Add explicit breakeven math to Gold's mode selection**

  Fix 3 adds the formula; this task makes the breakeven threshold explicit and adds worked examples so Gold can apply it quickly without recalculating from first principles each time.

  **Files:**
  - `~/.claude/agents/golds.md` — append a `## Spectrum vs Sequential Breakeven Examples` section after the Mode Selection table

  **Add after the Mode Selection table:**

  ```markdown
  ## Spectrum vs Sequential Breakeven Examples

  These worked examples let Gold pattern-match quickly rather than recalculating every time.

  | Tasks | Sizes | Sequential | Spectrum | Recommendation |
  |-------|-------|-----------|---------|----------------|
  | 3 | S, S, S | 1.5 hr | 30+3+15 = 48 min | Spectrum (reaping) wins |
  | 5 | S×5 | 2.5 hr | 30+3+25 = 58 min | Spectrum (reaping) wins |
  | 8 | S×8 | 4 hr | 30+8+40 = 78 min | Spectrum (full) wins 2x |
  | 4 | M×4 | 8 hr | 2+3+20 = ~2.5 hr | Spectrum wins strongly |
  | 3 | S, S | 1 hr | 30+1+15 = 46 min | Marginal — ask user |
  | 2 | S, S | 1 hr | 30+1+10 = 41 min | Sequential preferred (< 0.7x threshold) |

  **Rule of thumb for quick decisions:**
  - Any task that is M or larger: Spectrum almost always wins
  - All-S tasks with 4+ Howlers: Spectrum usually wins; run the formula
  - All-S tasks with 3 or fewer Howlers: sequential is competitive; show the math and ask

  **Note:** These estimates assume Howlers do not fail. Add 30 min per expected failure
  (Orange diagnosis + resume) when the task domain is high-risk or under-specified.
  ```

  **Why this fixes the problem:** Fix 3 gives Gold the formula. Fix 4 gives Gold calibrated examples that remove the need to estimate "is this big enough for Spectrum?" from scratch. The table also surfaces the counter-intuitive result that even all-S spectrums can win if there are 5+ Howlers — preventing Gold from over-routing to sequential for medium-sized jobs.

  **Tests:** Manual review — verify the worked examples table is present, verify the note about failure cost is included, verify the rule-of-thumb bullets are present.

- [ ] **Pre-MR pipeline**
  1. `code-reviewer` — resolve any blockers
  2. `test-runner` — fix failures; note coverage gaps
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

## References

- `~/.claude/agents/howlers.md` — Howler agent definition (25 lines, current)
- `~/.claude/HOWLER-OPS.md` — Howler operating manual (270 lines)
- `~/.claude/SPECTRUM-OPS.md` — Gold's muster and dispatch reference
- `~/.claude/agents/golds.md` — Gold agent definition with mode selection table
- Benchmark result: Route A (1 agent, 8 tasks, 86k tokens, 22 min, 8/8) vs Route B (Spectrum, 397k tokens, 101 min, 6/8)
- Aider repo-map concept: tree-sitter AST → function signatures → PageRank by import centrality (Gold approximates this manually via codebase_index.py)
