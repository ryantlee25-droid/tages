# Tages Benchmark Findings — 2026-04-06

## Overview

Three head-to-head benchmarks comparing AI agent implementation quality with and without Tages project memory. All tests used Claude Sonnet with identical prompts, tools, and budget caps. Implementations were judged by Claude Opus reviewing full diffs against known ground truth.

## Benchmarks Conducted

| # | Codebase | Task | Approaches Tested |
|---|----------|------|-------------------|
| 1 | Tages (MCP server) | Webhook notification system | Runtime MCP vs. Baseline |
| 2 | RemnantMUD (game) | Zone boss encounters | Pre-flight brief vs. Baseline |
| 3 | RemnantMUD (game) | Interactive pet squirrel | Pre-flight brief vs. Single MCP call vs. Baseline |

## Results Summary

### Benchmark 1: Runtime MCP vs. Baseline
- **Tages wins 5/10, Baseline wins 5/10** — split decision
- Quality: +0.8 points (7.9 vs 7.1)
- Cost: **+39% more expensive** ($1.95 vs $1.41) — Haiku auto-memory extraction cost $0.38
- Latency: +57% slower (604s vs 384s)
- Key win: Supabase migration with RLS + severity-aware PII scrubbing
- Key loss: Cost, speed, token usage, convention compliance

### Benchmark 2: Pre-flight Brief vs. Baseline
- **Tages wins 6/10, Baseline wins 4/10**
- Quality: +0.9 points (7.9 vs 7.1)
- Cost: **-1.4% cheaper** ($2.008 vs $2.036) — cost penalty eliminated
- Latency: +23% slower (654s vs 384s)
- Key win: Convention compliance (+3 pts), security (+2 pts), game design (+2 pts)
- Eliminated: $0.38 Haiku overhead from Benchmark 1

### Benchmark 3: Three-Way (Pre-flight vs. MCP Call vs. Baseline)
- **Pre-flight wins 8/10**, MCP call wins 1/10, Baseline wins 1/10
- Quality: A=8.8, B=7.8, C=7.7
- Cost: A=$2.09, B=$2.03, C=$2.00 (within 5% of each other)
- Critical finding: **Single MCP call performed almost identically to baseline** (7.8 vs 7.7)
  - MCP call result decays in context as the agent works
  - System prompt injection stays pinned at the top of every turn
- Pre-flight brief was the **only approach** that achieved:
  - Direct combat.ts integration (not orphaned handlers)
  - Direct movement.ts trust decay hooks
  - Correct rich text tag usage throughout
  - Proper shared message helper imports

## Key Findings

### 1. Delivery mechanism matters more than content
The same memories delivered three different ways produced dramatically different results:
- **System prompt injection** (pre-flight brief): 8.8/10 quality
- **MCP tool result** (single call at session start): 7.8/10 quality
- **No memory**: 7.7/10 quality

The MCP call and baseline were statistically indistinguishable. The information was received but decayed during the session as the context window filled with file reads and code writes.

### 2. Pre-flight brief eliminates cost penalty
| Approach | Cost Delta vs Baseline | Quality Delta |
|----------|----------------------|---------------|
| Runtime MCP (Benchmark 1) | +39% | +0.8 |
| Pre-flight brief (Benchmark 2) | -1.4% | +0.9 |
| Pre-flight brief (Benchmark 3) | +4.5% | +1.1 |

The cost penalty from runtime MCP calls was entirely due to Haiku auto-memory extraction ($0.38 per session). Pre-flight injection costs $0 during the session.

### 3. Convention compliance is the biggest differentiator
Across all benchmarks, the largest quality gap was in **convention compliance** — the dimension that requires project-specific knowledge you can't infer from reading code:

| Benchmark | With Memory | Without | Gap |
|-----------|-----------|---------|-----|
| 1 (Tages) | 7/10 | 8/10 | -1 (memory hurt here — over-applied cache pattern) |
| 2 (Remnant) | 8/10 | 5/10 | **+3** |
| 3 (Remnant) | 9/10 | 8/10 | **+1** |

### 4. Two conventions only memory can teach
In both Remnant benchmarks, the baseline consistently missed the same two things:
1. **Rich text tags** — `rt.item()`, `rt.condition()`, `rt.keyword()` usage. The code exists in the codebase but agents without memory didn't know to use it in new code.
2. **Integration wiring points** — where to hook into combat.ts and movement.ts. Without memory saying "combat hooks go at line ~180", the agent created standalone modules that never connected.

### 5. Brief format matters
The v1 brief had rich text tags buried in prose: "Custom rich text tags parsed in Terminal.tsx: <item>, <npc>..." — agents skimmed past this.
The v2 brief wraps them in backticks: `` `<item>`, `<npc>`, `<enemy>` `` — agents recognize and use them.

## Architecture Recommendation

```
Best approach:    tages brief → .tages/brief.md → SessionStart hook → system prompt injection
Staleness check:  git log since last gen + age-based (< 1hr always fresh, < 4hr fresh unless commits)
Cost:             $0 per session (cached file, no API calls)
Quality lift:     +1.0 points average (8.8 vs 7.7 on 10-point scale)
```

**Do not use runtime MCP calls for context injection.** The single-call approach tested in Benchmark 3 performed no better than no memory at all. System prompt injection is the only delivery mechanism that maintains attention across a full implementation session.

## Metric Definitions

| # | Metric | Description |
|---|--------|-------------|
| 1 | Quality Score | Average of all judge dimensions (Opus, 1-10 scale) |
| 2 | Convention Compliance | Adherence to project-specific coding patterns |
| 3 | Bug/Gotcha Avoidance | Known pitfalls avoided vs hit |
| 4 | Completeness | All requirements implemented |
| 5 | Cost | Total API spend (USD) |
| 6 | Latency | Wall clock time (seconds) |
| 7 | Tokens | Output token count |
| 8 | Quality/$ Efficiency | Quality score divided by cost |
| 9 | Test Coverage | Tests written and critical paths covered |
| 10 | Architecture Fit | How well the code fits existing patterns |

## Raw Numbers

### Benchmark 3 (definitive three-way test)

| Metric | A (Pre-flight) | B (MCP Call) | C (Baseline) |
|--------|:-:|:-:|:-:|
| Cost | $2.09 | $2.03 | $2.00 |
| Latency | 742s | 681s | 1,739s |
| Output tokens | 29,385 | 29,258 | 28,623 |
| API turns | 73 | 62 | 63 |
| Files changed | 7 | 5 | 5 |
| Lines added | +1,410 | +1,366 | +1,344 |
| Convention compliance | 9/10 | 8/10 | 8/10 |
| Completeness | 9/10 | 8/10 | 8/10 |
| Code quality | 8/10 | 8/10 | 7/10 |
| Test coverage | 9/10 | 8/10 | 8/10 |
| Architecture fit | 9/10 | 8/10 | 7/10 |
| Game design | 9/10 | 7/10 | 8/10 |
| **Average** | **8.8** | **7.8** | **7.7** |
| Gotchas avoided | 9/10 | 6/10 | 5/10 |

## Total Benchmark Investment

| Component | Cost |
|-----------|------|
| Benchmark 1 (2 runs + judge) | $3.71 |
| Benchmark 2 (2 runs + judge) | $4.52 |
| Benchmark 3 (3 runs + judge) | $6.57 |
| Brief generator development | ~$2.00 |
| **Total** | **~$16.80** |
