# LongMemEval Harness for Tages

Reproducible evaluation of Tages's memory recall on the LongMemEval benchmark.

## Status

**First calibration pending re-run with the Phase 1 fixes below.** Target ≥80% overall accuracy on the oracle split per RetainDB methodology. Flip signal: <70% on a 50-question stratified subset.

Report TWO numbers, not one, once a run completes:
- `overall_accuracy` — the harness's synthetic GPT-4o reader's accuracy. Useful for regression-tracking the harness itself, but do NOT report a delta here as a Tages *product* improvement unless it's attributable to the retrieval-quality metric below.
- `recall_at_k` — whether at least one recalled memory's tagged session id was in the question's gold `answer_session_ids`. This is the number that actually reflects product retrieval quality — cite this one when claiming a product win.

Everything in this harness (ingestion strategy, prompts, judge, this doc) is EVAL-ONLY scaffolding around the `tages remember`/`tages recall` CLI — it changes what this benchmark measures, not what real Tages users (via the MCP `recall` tool or CLI) experience.

## Dataset

**Source:** [`xiaowu0162/longmemeval-cleaned`](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned) on Hugging Face — the `longmemeval_oracle` split (500 questions, ~15 MB).

**Caveat on comparability:** published Supermemory (81.6%) and RetainDB (79%) numbers were measured on the ORIGINAL (now-deprecated) LongMemEval dataset. The cleaned version removes noisy history sessions, so our numbers are not directly comparable. We track cleaned numbers for internal regression but will re-run the deprecated version if direct comparison is required.

**Schema per row:**
- `question_id`, `question_type`, `question`, `answer` (ground truth)
- `haystack_sessions`: list of prior conversation sessions (user/assistant turns)
- `answer_session_ids`: which sessions contain the evidence
- `haystack_dates`: ISO-ish dates for each session

**Question types (500 total):** temporal-reasoning (133), multi-session (133), knowledge-update (78), single-session-user (70), single-session-assistant (56), single-session-preference (30).

## Methodology

**What this section used to claim but never implemented:** earlier drafts of this doc described ingestion as writing structured `{session_id, turn_index, date}` metadata per turn and recall as using "a 3-turn context window heuristic." Neither ever existed in code — `memory.ts` had no turn-level ingestion at all (whole sessions only) and `recall()` was, and still is, a flat top-k call with no windowing. Turn-level *ingestion* (not turn-level metadata, and not a context-window heuristic) landed as of this revision; see below for what's actually implemented today.

What's actually implemented (`src/memory.ts`, `src/answer.ts`, `src/prompts.ts`, `src/run.ts`):

1. **Memory ingestion (per question, `TagesCliStore.ingest`):** Create a fresh memory space (`clear()` first). Iterate each turn of each haystack session in chronological order and write one memory per turn via `tages remember`, keyed `longmemeval-<question_id>-s<i>-t<j>`. Each memory's text carries a `[session=<id> date=<date>]` tag (not structured metadata fields — a plain-text prefix) so retrieval-quality scoring can attribute a recalled turn back to its source session.
2. **Recall:** Given `question`, call `tages recall` and take the top `--top-k` memories (default 30 — bumped from the original 10 now that ingestion is turn-level and produces far more rows per question than session-level did). There is no context-window heuristic of any kind; this is a flat top-k call.
3. **Answer generation:** Prompt GPT-4o at `temperature=0` with a type-aware system prompt (date-arithmetic and numeric-aggregation instructions; a distinct preference-response mode for `single-session-preference`) plus a Chain-of-Note "write relevance notes, then answer" instruction, given `(question, recalled memories)` → answer text.
4. **Judge:** GPT-4o at `temperature=0` compares `answer` vs ground truth, using a per-question-type prompt: rubric-satisfaction judging for `single-session-preference` (the oracle's `answer` field is a rubric, not a literal answer, for this type), correct-decline judging for abstention questions (`question_id` ending `_abs`), one-day-tolerant judging for `temporal-reasoning`, and factual-equality judging for every other type → `correct | incorrect`.
5. **Retrieval-quality metric (`recall_at_k`):** independent of the judge above — for each question, checks whether any recalled memory's `[session=<id> ...]` tag is in the question's gold `answer_session_ids`. Reported separately from `overall_accuracy` because it measures whether the right evidence was retrieved, not whether GPT-4o phrased an answer correctly.

See `src/prompts.ts` for exact prompts.

## Run

### First-time setup

```bash
cd eval/longmemeval
pnpm install
# Download oracle split (~15 MB):
node src/download.js
```

### Calibration (50-question stratified sample)

```bash
export OPENAI_API_KEY=sk-...
pnpm run -- --n 50 --seed 42 --output results/tages-calibration-$(date +%Y%m%d).json
```

**Estimated cost:** $1–3 (GPT-4o at ~500 tokens per generate + judge × 50 questions × 2 calls).

If overall accuracy <70% on the calibration sample, **stop**: this is the flip signal per `positioning.md` §10. Debug before running full.

### Full 500-question run

```bash
pnpm run -- --n 500 --output results/tages-run-001.json
```

**Estimated cost:** $15–30.

## Output

Results JSON:

```json
{
  "run_id": "tages-calibration-20260420",
  "dataset_sha": "98d7416c24c7...",
  "model_answer": "gpt-4o-2024-08-06",
  "model_judge": "gpt-4o-2024-08-06",
  "tages_version": "0.2.1",
  "n": 50,
  "overall_accuracy": 0.78,
  "accuracy_by_type": {
    "temporal-reasoning": 0.74,
    "multi-session": 0.81,
    "knowledge-update": 0.83,
    "single-session-user": 0.80,
    "single-session-assistant": 0.77,
    "single-session-preference": 0.72
  },
  "recall_at_k": 0.85,
  "recall_at_k_by_type": {
    "temporal-reasoning": 0.80,
    "multi-session": 0.88,
    "knowledge-update": 0.90,
    "single-session-user": 0.86,
    "single-session-assistant": 0.83,
    "single-session-preference": 0.79
  },
  "duration_seconds": 612,
  "cost_usd_estimate": 1.92,
  "failures": [{ "question_id": "gpt4_2655b836", "reason": "..." }]
}
```

`overall_accuracy`/`accuracy_by_type` score the synthetic GPT-4o reader (harness-only). `recall_at_k`/`recall_at_k_by_type` score whether the right evidence was retrieved (the number that reflects real Tages retrieval quality) — see Status above.

## Roadmap

- **v1 (this file):** ingest → recall → answer → judge, plus (this revision) per-type judging, a type-aware answer prompt, Chain-of-Note reading, turn-level ingestion, and the recall@k retrieval-quality metric. All still EVAL-ONLY harness scaffolding.
- **v2 (not yet implemented):** structured per-turn metadata (`has_answer` flags, `turn_index` as a queryable field rather than a text tag), ingest-time LLM summarisation into the 6 canonical memory types, and any recall-side context-window heuristic.
- **v3:** harness publishable externally — anyone with `OPENAI_API_KEY` + a Tages project should be able to reproduce. Entry in `docs/benchmark-partnerships.md`.
