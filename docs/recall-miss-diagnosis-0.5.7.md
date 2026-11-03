# Recall miss at ~55 memories: diagnosis (0.5.7, bug 13)

## Symptom

In a project of about 55 memories, `tages recall "<a memory's exact sentence>" --limit 10`
did not return that memory, although its cloud row was live and embedded. The
same query worked in a project of 6 memories. Retries did not help (phase 14,
"ranked CLI recall by the teammate finds the memory by its own sentence").

## Verdict

The cause is the CLI's evidence ordering in `packages/cli/src/commands/recall.ts`,
not the HNSW index, not the relevance floor, and not the candidate pool.

`stableSortByEvidence` sorted the fused candidates on the evidence weight alone,
with RRF order used only as a tiebreak. That is a partition: every row with a
higher weight moved ahead of every row with a lower one, regardless of relevance.
The write paths set the weights like this:

| Write path | `evidence` | weight |
|---|---|---|
| CLI `remember` | `declared` | 0.95 |
| MCP `remember` | `inferred` | 0.75 |
| import, observe/session_end, approve, auto-index, dashboard | NULL | 1.0 |

So a memory just written with `tages remember` (`declared`) sorted behind every
NULL-evidence row in the candidate pool. The semantic RPC's 0.3 threshold admits
almost the whole project (gte-small cosines sit in a 0.69 to 0.95 band), so the
pool holds the whole project, up to 50 rows. With 10 or more NULL rows, the
target falls off `--limit 10`. With 6 memories, the whole project fits inside
the limit, so the target still shows. That is the "works at 6" observation.

Confidence: high. The miss reproduces on prod with this cause isolated (below),
and the fix turns the miss into a rank-0 hit on the same fixture.

## Evidence (prod `wezagdgpvwfywjoxztfs`, 2026-11-03)

I ran a scratch fixture: one test user and one project under the
`tages-e2e-<stamp>` prefix, created with the service key and deleted in
`finally`. A follow-up query confirmed no projects or probe users were left. I
inserted 55 memories with real hosted (gte-small) embeddings. The target was
`The legacy exporter archivetarget<stamp> still runs on the old cluster.` (the
phase 14 text) with `evidence='declared'`. The other 54 rows were a third each
NULL, `inferred` and `declared`. The query was the target's exact sentence. I
called the RPCs directly as the owner, and ran the CLI with
`TAGES_DEBUG_RECALL=1 --limit 10` and a fixture HOME.

Before the fix (CLI built from `38a2f83`):

| Stage | `semantic_recall` (pool 50, threshold 0.3) | trigram | relevance verdict | CLI `--limit 10` |
|---|---|---|---|---|
| 6 memories | 6 of 6 rows, target rank 0, sim 1.000 | target rank 0 | strong-top-score (top 1.000, z 2.20) | found, position 2 (behind 2 NULL rows) |
| 55 memories | 50 of 50 possible, target rank 0, sim 1.000 | target rank 0 | strong-top-score (top 1.000, z 6.04) | **MISSING**: all 10 results were NULL-evidence rows |
| 55, run 2 | same | same | same | **MISSING** (deterministic, not flaky) |
| 55, NULL rows patched to `declared` | same | same | same | found, position 0 |

After the fix (this branch): 55 memories gave found at position 0 on both runs.
6 memories gave found at position 2.

What this rules out:

- **HNSW post-filter (the plan's leading suspect).** It did not reproduce. At 55
  rows in the crowded prod table, `semantic_recall` returned the full 50-row
  pool, and the target was first with similarity 1.000. Caveat: PostgREST gives
  no way to run `EXPLAIN` or `SET LOCAL hnsw.ef_search`, and I have no direct DB
  connection, so I did not measure the index plan itself. The result shows the
  RPC output was complete for this project size. It does not prove the global
  index can never truncate a larger project. That stays an open risk for later
  growth, not the cause of this bug.
- **Relevance floor (`shared/src/relevance.ts`).** Not the cause. The verdict was
  `strong-top-score` at both sizes, so the semantic channel was kept. No change
  to shared, and no shared version bump.
- **Candidate pool (50) and rerank window.** Not the cause. The target was rank 0
  in both channels. The reranker is a no-op without `OPENAI_API_KEY` +
  `TAGES_OPENAI_EMBED`.
- **Near-duplicate dedupe.** Not the cause. No other row's text contained the
  target's.

## Fix (code only, no migration)

`recall.ts` now multiplies the evidence weight into the fused RRF score instead
of sorting on the weight alone (`rrf.ts` gains `reciprocalRankFusionScored`, and
each row carries `rrf_score`). The 0070 intent still holds. Between two rows of
comparable relevance, the better-established one leads: inferred at rank 1
scores 2/61 x 0.75 = 0.025, verified at rank 10 scores 2/70 x 1.0 = 0.029.
An exact match is no longer buried. With k=60, a 0.95 weight costs about three
rank positions on one list, not the whole pool.

Regression tests are in `packages/cli/src/__tests__/recall-newest.test.ts`: a
`declared` rank-1 row with 14 NULL rows after it stays inside `--limit 10`, and
verified still outranks inferred. Before the fix, the first test failed.

Not changed, worth a later look: NULL evidence weighs 1.0, the same as
`verified`, so unassessed rows still edge out `declared` ones of equal
relevance. Making NULL neutral (for example 0.95) is a product decision, and
it would also touch the server ranker.

## Migration

None needed for this bug. I wrote nothing to `supabase/migrations/` and applied
nothing.
