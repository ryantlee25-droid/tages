# LongMemEval Harness for Tages

Reproducible evaluation of Tages's memory recall on the LongMemEval benchmark.

## Status

**First calibration pending.** Target ≥80% overall accuracy on the oracle split per RetainDB methodology. Flip signal: <70% on a 50-question stratified subset.

## Dataset

**Source:** [`xiaowu0162/longmemeval-cleaned`](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned) on Hugging Face — the `longmemeval_oracle` split (500 questions, ~15 MB).

**Caveat on comparability:** published Supermemory (81.6%) and RetainDB (79%) numbers were measured on the ORIGINAL (now-deprecated) LongMemEval dataset. The cleaned version removes noisy history sessions, so our numbers are not directly comparable. We track cleaned numbers for internal regression but will re-run the deprecated version if direct comparison is required.

**Schema per row:**
- `question_id`, `question_type`, `question`, `answer` (ground truth)
- `haystack_sessions`: list of prior conversation sessions (user/assistant turns)
- `answer_session_ids`: which sessions contain the evidence
- `haystack_dates`: ISO-ish dates for each session

**Question types (500 total):** temporal-reasoning (133), multi-session (133), knowledge-update (78), single-session-user (70), single-session-assistant (56), single-session-preference (30).

## Methodology (RetainDB pattern)

Per LongMemEval paper + RetainDB appendix:

1. **Memory ingestion (per question):** Create a fresh memory space. Iterate each turn of each haystack session in chronological order. Write memories via `tages remember` with metadata `{session_id, turn_index, date}`.
2. **Recall:** Given `question`, call Tages recall with a 3-turn context window heuristic. Take top-k=10 memories.
3. **Answer generation:** Prompt GPT-4o at `temperature=0` with `(question, recalled memories)` → answer text.
4. **Judge:** GPT-4o at `temperature=0` compares `answer` vs ground truth → `correct | incorrect`.

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
  "duration_seconds": 612,
  "cost_usd_estimate": 1.92,
  "failures": [{ "question_id": "gpt4_2655b836", "reason": "..." }]
}
```

## Roadmap

- **v1 (this file):** simple ingest → recall → answer → judge.
- **v2:** turn-by-turn extraction (each user/assistant turn becomes a distinct memory with `has_answer` metadata), ingest-time LLM summarisation into the 6 canonical memory types.
- **v3:** harness publishable externally — anyone with `OPENAI_API_KEY` + a Tages project should be able to reproduce. Entry in `docs/benchmark-partnerships.md`.
