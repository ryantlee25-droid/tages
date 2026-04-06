# Tages — Evidence of Quality Impact

Tages has been tested, not just built. This document consolidates all test results.

---

## Test 1: Cold vs Warm A/B (Code Generation)

**Task:** Add "Ash Walker" fire enemy to a 30k LOC MUD game
**Method:** Same prompt to Sonnet, once with no context (cold) and once with Tages memories (warm)

| Category | Cold | Warm | Improvement |
|----------|------|------|-------------|
| Quality | 1.5/10 | 10/10 | +567% |
| Efficiency | 4/10 | 9/10 | +125% |
| Reliability | 3/10 | 10/10 | +233% |
| **Overall** | **2.8/10** | **9.7/10** | **+246%** |

Key findings:
- Cold agent produced 11 errors. Warm agent produced 0.
- Cold agent followed 1/6 conventions. Warm followed 6/6.
- Cold agent needed 3-4 revision cycles. Warm needed 0-1.
- Cost of injected context: ~$0.003 (1,200 tokens)

## Test 2: DocGen MCP (Documentation Generation)

**Task:** Generate combat system documentation from source code
**Method:** Same source code to Sonnet via DocGen MCP, cold vs warm, 3 test runs

### Test 1 — Combat System Architecture

| Category | Cold | Warm | Weight | Cold Weighted | Warm Weighted |
|----------|------|------|--------|---------------|---------------|
| Quality | 6.8 | 9.2 | 60% | 4.08 | 5.52 |
| Efficiency | 7.5 | 8.0 | 25% | 1.88 | 2.00 |
| Reliability | 7.0 | 8.5 | 15% | 1.05 | 1.28 |
| **Total** | | | | **7.01** | **8.80** |

**Quality improvement: +26% (7.01 -> 8.80)**

Key findings:
- Cold missed 2 of 8 systems (called shots, environment hazards). Warm covered all 8.
- Cold: 3/10 convention awareness. Warm: 9/10.
- Warm included new-enemy checklist, rich text conventions, stat rebalance history.

## Test 3: Blind Review (Independent Validation)

**Method:** Both cold and warm documentation outputs sent to ChatGPT and Gemini for blind scoring. Neither reviewer knew which document used Tages.

### ChatGPT Blind Review

| Metric | Cold | Warm |
|--------|------|------|
| Score | 4.4/10 | 6.7/10 |

**Warm scored 52% higher.**

### Gemini Blind Review

| Metric | Cold | Warm |
|--------|------|------|
| Score | 5.6/10 | 9.8/10 |

**Warm scored 75% higher.**

### Combined Blind Review Average

| | Cold | Warm | Delta |
|--|------|------|-------|
| Average | 5.0 | 8.3 | **+66%** |

Neither reviewer identified fabricated systems in the warm output. ChatGPT identified "multiple inaccuracies and fabricated system interactions" in the cold output.

## Hallucination Impact

| | Cold | Warm |
|--|------|------|
| Fabricated systems | 8 | 0 |
| Fabricated conventions | 5 | 0 |
| Wrong file paths | 1 | 0 |
| **Total hallucinations** | **14** | **0** |

## Cost Analysis

| Metric | Value |
|--------|-------|
| Memories injected per session | ~18 |
| Tokens per session | ~1,200 |
| Cost per session (Claude API) | ~$0.003 |
| Revision cycles saved | 3-4 per task |
| Developer time saved per task | ~30-60 min |

---

## Methodology Notes

- All tests used the same model (Claude Sonnet) with identical prompts
- Cold agent received only source code. Warm agent received source code + Tages memories.
- Blind reviewers received documents with no identifying labels or context about which used memory
- Scoring rubrics were defined before tests were run (not post-hoc)
- Raw test outputs available in `test-ab/`

## Raw Data

- `test-ab/cold-agent-output.md` — Cold agent code generation output
- `test-ab/warm-agent-output.md` — Warm agent code generation output
- `test-ab/scorecard.md` — Full 10-metric scoring breakdown
- `test-ab/docgen/` — DocGen MCP test outputs and scores
- `test-ab/docgen-mcp/` — DocGen with MCP integration test data
