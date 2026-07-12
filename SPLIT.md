# SPLIT: two-stage-retrieval-0710

Base branch: `main` @ `42360b8`
Plan source: `PLAN.md` lines 705-1079 ("Two-Stage Retrieval (RRF Fusion + Rerank) and Multi-Vector Chunk Storage")
Feature branch (merge target for all 4 Howlers): `feat/two-stage-retrieval`

Consolidates the plan's own 7 fine-grained waves (PLAN.md:1041-1049) into 4 disjoint-file parallel
Howlers + one post-merge integration task, per `lessons_benchmark-war-0404`
(coordination overhead > value — drop fast, merge fast, verify post-merge once).

Task 0 (DEV-pointed eval project, PLAN.md:794-805) is being run by the main context directly, not a
Howler — it's a no-code, human-interactive OAuth step per the plan's own note.

---

## Pre-flight (main context, before dropping any Howler)

1. **PLAN.md's amendment is uncommitted.** `git status` shows `M PLAN.md` on `main` — the section this
   split is based on (lines 705-1079) exists only in the working tree, not in commit `42360b8`. A
   worktree created with `git worktree add <path> 42360b8` will **not** contain it. Either commit
   PLAN.md on `main` first, or copy the current `PLAN.md` into each of the 4 worktrees right after
   `git worktree add`, before dropping the Howler. Do this before any Howler starts reading its task
   spec.
2. Confirm no stray worktree is already checked out inside the main repo path (`git worktree list`) —
   one exists today (`.claude/worktrees/agent-aef53c8a64a791834` on `feat/multi-agent-instrumentation`)
   and is unrelated; leave it alone, don't reuse its path.
3. Surface to Ryan now, not just at the gate: PLAN.md's Open Questions (line 1061) flags
   `@huggingface/transformers` as a **new runtime dependency class** for this repo (first break from the
   no-new-runtime-deps convention held by `embedding.ts`/`chunking.ts`/`date-extraction.ts`), needed by
   Howler A (Task 2) and Howler C (Task 6). Ratify or veto before merge — reverting to
   `OpenAIJudgeReranker`-only requires no other task restructuring since both implementations sit behind
   the same `Reranker` interface.

---

## File Ownership Matrix

| Howler | Branch | PLAN.md Tasks | Creates | Modifies |
|--------|--------|---------------|---------|----------|
| **A — CLI retrieval chain** | `howler-a-cli-retrieval` | 1 (854-865), 2 (867-879), 3 (881-893), 4-CLI-half (895-906) | `packages/cli/src/lib/rrf.ts`, `packages/cli/src/lib/reranker.ts`, `packages/cli/src/lib/temporal-recall.ts`, `packages/cli/src/__tests__/rrf.test.ts`, `packages/cli/src/__tests__/reranker.test.ts`, `packages/cli/src/__tests__/temporal-recall.test.ts`, `packages/cli/src/__tests__/recall-assembled-context.test.ts` | `packages/cli/src/commands/recall.ts` (sequential: Task1→2→3→4), `packages/cli/src/__tests__/recall.test.ts` (sequential), `packages/cli/src/lib/temporal-sort.ts` (add `export` to `extractTargetDate`), `packages/cli/src/index.ts` (register `--assembled-context` option), `packages/cli/package.json` (add `@huggingface/transformers`) |
| **B — SQL migrations** | `howler-b-sql-migrations` | 5 (908-922), 8 (953-960), 10 (980-991) | `supabase/migrations/0062_hybrid_recall_rrf_fusion.sql`, `supabase/migrations/0063_memory_chunks_schema.sql`, `supabase/migrations/0064_chunk_aware_recall.sql` | — (SQL-only, zero TS/JS overlap) |
| **C — MCP-server chain** | `howler-c-mcp-server` | 6 (924-936), 7 (938-947), 4-server-half (895-906) | `packages/server/src/search/reranker.ts`, `packages/server/src/search/temporal-channel.ts`, `packages/server/src/__tests__/reranker.test.ts`, `packages/server/src/__tests__/temporal-channel.test.ts` | `packages/server/src/tools/recall.ts` (sequential: Task6→7→4), `packages/server/src/search/ranker.ts` (export/reuse `reorderProximity`), `packages/server/src/schemas.ts` (add `args.assembledContext` to `recall` tool's Zod schema), `packages/server/package.json` (add `@huggingface/transformers`), `packages/server/src/__tests__/recall.test.ts` (or equivalent — confirm exact filename during implementation) |
| **D — chunk write path + backfill** | `howler-d-chunk-write-path` | 9 (962-978), 12 (1006-1015) | `packages/server/src/__tests__/embeddings.test.ts`, `packages/cli/src/__tests__/embedding.test.ts`, `packages/server/src/__tests__/sqlite.test.ts` (filename TBD — check for an existing sqlite test file first, extend rather than collide), `packages/server/scripts/backfill-chunk-embeddings.ts`, `packages/server/scripts/backfill-chunk-embeddings.test.ts` | `packages/server/src/embeddings.ts`, `packages/cli/src/lib/embedding.ts`, `packages/server/src/tools/remember.ts`, `packages/cli/src/commands/remember.ts`, `packages/server/src/cache/sqlite.ts`, `packages/server/src/sync/supabase-sync.ts` (add `remoteUpsertChunks` only — Task 11 adds `remoteChunkSemanticRecall` to this same file post-merge, sequential after D) |
| **Post-merge (main context, not a Howler)** | (works on `feat/two-stage-retrieval` directly) | 11 (993-1005) — integration | — | `packages/cli/src/commands/recall.ts` (after A merges, runs last in CLI chain), `packages/cli/src/__tests__/recall.test.ts`, `packages/server/src/tools/recall.ts` / `packages/server/src/sync/supabase-sync.ts` (after C and D merge, runs last in server chain, sequenced after D's `remoteUpsertChunks`), `packages/server/src/__tests__/recall.test.ts` |

Task 0 (DEV eval env, PLAN.md:794-805): main context, in parallel with the 4 Howlers, not gated on any of them (only gates the E2E validation step, not the coding).

---

## Ownership Rules

- No file appears in two Howlers' Creates/Modifies columns. Verified against PLAN.md's own File
  Ownership Matrix (lines 1017-1039) and its explicit conflict-resolution notes (1035-1039) — see
  Conflict Analysis below.
- Files each Howler must **not** touch:
  - **A**: anything under `packages/server/**`, `supabase/migrations/**`, `packages/cli/src/commands/remember.ts`, `packages/cli/src/lib/embedding.ts`, `packages/server/package.json`.
  - **B**: any `.ts`/`.js` file, anywhere. Write migration files only — **do not run `supabase db push` / `migration up` / apply anything to DEV or prod.** Main context applies post-merge.
  - **C**: anything under `packages/cli/**`, `supabase/migrations/**`, `packages/server/src/sync/supabase-sync.ts`, `packages/server/src/embeddings.ts`, `packages/server/src/tools/remember.ts`, `packages/server/src/cache/sqlite.ts`.
  - **D**: `packages/cli/src/commands/recall.ts`, `packages/server/src/tools/recall.ts`, `packages/server/src/search/**`, `supabase/migrations/**`, `packages/cli/src/lib/{rrf,reranker,temporal-recall,temporal-sort}.ts`.

---

## Conflict Analysis

Cross-checked every file in PLAN.md's own File Ownership Matrix (1017-1039) against this 4-way
grouping. **No new conflicts found** — the plan's own sequential chains collapse cleanly into A and C
without crossing Howler boundaries:

- `packages/cli/src/commands/recall.ts`: plan chain is Task1→2→3→4→11. Tasks 1/2/3/4-CLI-half are all
  Howler A, executed sequentially inside one worktree by one agent — this is exactly what the plan's own
  note says to preserve ("strictly sequential"). Task 11 is deliberately excluded from A and left for
  post-merge, since it also needs migration 0064 (Howler B) and the chunk write path (Howler D) merged
  first — it cannot be coded correctly inside A's worktree.
- `packages/server/src/tools/recall.ts`: plan chain is Task6→7→4-server-half→11. Same pattern — 6/7/4 are
  all Howler C, sequential in one worktree; Task 11 held for post-merge for the same reason (also needs B
  and D).
- **PLAN.md's own explicit warning (line 1037) is the one sharp edge**: Task 4 is *not* a single atomic
  unit — its CLI half sits in the middle of the CLI chain (after Task 3) and its server half sits at the
  *end* of the server chain (after Task 6/7, before Task 11). This split respects that: A gets Task 4's
  CLI half only, C gets Task 4's server half only. Neither Howler needs the other's half to compile or
  test its own half (the CLI's `--assembled-context` flag and the MCP tool's `assembledContext` arg are
  independently wired, sharing only a conceptual grouping/budget algorithm, not code).
- `packages/server/src/sync/supabase-sync.ts`: plan says Task 9 (write, `remoteUpsertChunks`) before Task
  11 (read, `remoteChunkSemanticRecall`), sequential, same file. Task 9 is Howler D; Task 11 is post-merge
  and D merges before the post-merge integration step runs, so the ordering holds.
- `packages/cli/package.json` / `packages/server/package.json`: touched by exactly one task each (2→A,
  6→C) in the original plan — no conflict, carried through unchanged.
- Howler B (SQL migrations, Tasks 5/8/10) has **zero** TS/JS file overlap with A/C/D by construction —
  the plan itself notes each of these three tasks has "zero file overlap with any TS file" or "any other
  task." Task 10 (migration 0064) has a *data* dependency on Task 8's schema and Task 9's chunk rows per
  the plan (line 988), but that's satisfied within B itself for the schema (B writes 0063 before 0064,
  same worktree) and is a runtime/data concern for Task 9, not a coding-time file dependency — B does not
  need D's code to write correct SQL against the schema B itself defines in 0063.
- Howler D (Tasks 9/12) has zero file overlap with A, B, or C. Task 9's *soft* dependency on Task 8's
  schema (B) is likewise not a coding-time blocker: D writes `sqlite.ts`'s local `memory_chunks` mirror
  and the Supabase-side `remoteUpsertChunks` call against the column shape PLAN.md's Task 8 spec (line
  955) already documents, without needing B's migration file merged or applied first.

No task-splitting adjustments were needed — the proposed grouping is file-disjoint as given.

---

## Standing Rules (all Howlers)

- **No `git checkout`/`stash`/`reset`/`restore` in your worktree.** If you need to discard local
  changes, stop and report — do not self-heal with a destructive git op (`feedback_worktree_git_checkout_corruption`).
- **No migration applies.** Howler B writes SQL files only. No Howler runs `supabase db push`,
  `migration up`, or anything that touches DEV or prod. Main context applies to DEV
  (`ugogdqzhhnuzwgcaovty`) only, post-merge, as part of Task 11 integration.
- **No prod anything, ever.** Prod is `wezagdgpvwfywjoxztfs` and stays at migration 0060 for this
  entire effort per PLAN.md's Scope section (line 762).
- **TypeScript strict mode** — matches repo convention (`CLAUDE.md`).
- **Per-package duplication convention, no cross-package imports for lib code.** `embedding.ts`,
  `reranker.ts`, `temporal-recall.ts`/`temporal-channel.ts` are each hand-duplicated once per package
  (`packages/cli/src/lib/*` vs `packages/server/src/search|embeddings*`), matching the existing
  `chunking.ts`/`date-extraction.ts` pattern — do not import across `@tages/cli`/`@tages/server`.
- **Stage files explicitly.** Never `git add -A` or `git add .`.
- **Commit when done**, don't open PRs — Copper does that, post-gate.
- Full mechanics: `~/.claude/HOWLER-OPS.md` (injected into each drop prompt).

---

## Merge Order

All 4 branches are file-disjoint, so merge order carries no conflict risk — recommend one-at-a-time
with a build/typecheck checkpoint after each to catch integration issues early rather than all-at-once:

1. **B** (`howler-b-sql-migrations`) — SQL-only, zero TS surface, fastest to verify, merge first.
2. **A** (`howler-a-cli-retrieval`)
3. **C** (`howler-c-mcp-server`)
4. **D** (`howler-d-chunk-write-path`) — merge last since post-merge Task 11 immediately extends the
   file D just modified (`supabase-sync.ts`) with `remoteChunkSemanticRecall`.

After each merge: `pnpm install && pnpm --filter @tages/server build && pnpm --filter @tages/cli build && pnpm typecheck`.

---

## Post-Merge Steps (main context — Task 11 + quality gate)

1. Confirm all 4 branches merged cleanly into `feat/two-stage-retrieval`; full workspace build +
   typecheck green.
2. **Implement Task 11** (PLAN.md:993-1005): wire `chunk_semantic_recall` into the CLI's
   `recall.ts` as a 4th ranked list into `reciprocalRankFusion` (after A's Task1/2/3/4 chain — runs
   last), and wire `remoteChunkSemanticRecall` into the server's `tools/recall.ts` +
   `supabase-sync.ts` (after C's Task6/7/4 chain and after D's `remoteUpsertChunks` — runs last on
   both files).
3. Apply migrations 0062/0063/0064 to **DEV only** (`ugogdqzhhnuzwgcaovty`). Verify with
   `supabase migration list --linked` before and after; separately confirm the same command against
   prod does **not** show them.
4. Run Task 12's backfill script (or a fresh re-ingest, per its own pre-mortem note at line 1014)
   against `longmemeval-sandbox-dev` — this must happen before step 6's rerun, per Task 11's own
   dependency note (line 1004).
5. Confirm Task 0 (DEV-pointed eval project, main context, run in parallel with the Howlers) is
   complete — it gates this step, not the coding above.
6. Run the **Standard rerun procedure** (PLAN.md:815-835): full 50-question calibration rerun, seed
   42, against `longmemeval-sandbox-dev`, diffed against baseline
   `eval/longmemeval/results/tages-pr-50q-20260710.json` on `overall_accuracy`, `recall_at_k`,
   per-type breakdowns, and the `recalled_memory_count == 0` row count (baseline 11/50, target ≤3/50
   per the recalibrated Expectation Calibration section, PLAN.md:724-727).
7. Run the **product-behavior smoke checklist** (PLAN.md:841-848) once, on the combined diff — dist
   freshness, real (non-mocked) CLI round-trip, DB round-trip against DEV, async/process-lifecycle,
   migration-scope check, rerank cost/latency sanity, default-output regression guard on
   `parseRecallKeys`.
8. **Quality gate** (once, on the combined diff, per `feedback_high_effort_review_gate`): White +
   Gray + high-effort `/code-review`, run in parallel. Zero blockers/failures/criticals to proceed;
   coverage gaps and security high/medium are PR-description warnings, not blockers. If White finds
   blockers, fix on `feat/two-stage-retrieval` and re-run White before the PR opens.
9. Confirm Definition of Done (PLAN.md:1067-1079), including explicit Ryan ratification of the
   `@huggingface/transformers` dependency (flagged at Pre-flight step 3 above — don't let this slide
   to the end).
10. Copper opens the PR (`gh auth switch --user ryantlee25-droid` first — branch protection on `main`
    requires it, per `project_tages_branch_protection`). PR description must flag, per PLAN.md's own
    Definition of Done: Tasks 5/6/7's "no harness rerun credit, product-parity only" scope, Tasks
    3/7's bounded temporal-date-resolution coverage, Task 12's single-project backfill scope, the new
    runtime-dependency tradeoff, and the Phase 3 deferrals (observation distillation, supersedence
    relations) — all as known, intentional scope boundaries, not silent gaps. No auto-merge.
11. Gold writes a brief `LESSONS.md` entry: what worked, what didn't, actionable improvements.
