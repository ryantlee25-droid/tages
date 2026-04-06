# We tested whether AI agent memory actually improves documentation. Here's the data.

Every AI coding session starts from scratch. Your agent re-discovers the architecture, violates naming conventions you've corrected three times, and confidently describes systems that don't exist.

We built [Tages](https://github.com/ryantlee25-droid/tages), an open-source MCP server that gives AI agents persistent memory about codebases. Then we did something most agent memory tools don't do: we tested whether it actually works.

---

## The hypothesis

If an AI agent has access to architectural decisions, naming conventions, and lessons learned from previous sessions, it should produce measurably better output than an agent working from source code alone.

Simple hypothesis. The question was: how much better, and is it worth the cost?

## The method

We used a 30k+ LOC game codebase (a MUD called The Remnant) with 30 stored memories: conventions, architecture decisions, lessons learned, entity definitions.

**Test 1: Code generation.** Same prompt to Claude Sonnet — "add a fire enemy called Ash Walker." One run with no memory (cold), one with Tages memories injected (warm). Scored on 10 metrics: correctness, convention compliance, architecture awareness, lesson retention, revision cycles, cost, latency, search recall, file placement, integration safety.

**Test 2: Documentation generation.** Same source code to the DocGen MCP server. Cold vs warm, 3 test runs, scored on quality/efficiency/reliability with a 10-metric rubric.

**Test 3: Blind review.** Both outputs sent to ChatGPT and Gemini for independent scoring. Neither reviewer knew which document used Tages. Neither was told what to look for.

## The results

### Code generation

| Category | Cold | Warm |
|----------|------|------|
| Overall score | 2.8/10 | 9.7/10 |
| Errors | 11 | 0 |
| Convention compliance | 1/6 | 6/6 |
| Revision cycles needed | 3-4 | 0-1 |

The cold agent produced plausible code with 11 errors. Every error was a reasonable guess — no agent would know this game uses "cold" not "ice" for damage types without project context. The warm agent got everything right on the first try.

### Documentation generation

| | Cold | Warm |
|--|------|------|
| Weighted score | 7.01/10 | 8.80/10 |
| Systems covered | 6/8 | 8/8 |
| Convention awareness | 3/10 | 9/10 |

The warm agent didn't just document what exists — it documented why things were built that way, what conventions to follow, and what mistakes to avoid.

### Blind review

| Reviewer | Cold | Warm |
|----------|------|------|
| ChatGPT | 4.4/10 | 6.7/10 |
| Gemini | 5.6/10 | 9.8/10 |

Neither reviewer knew which was which. Both scored the warm output significantly higher. ChatGPT noted "multiple inaccuracies and fabricated system interactions" in the cold output. The warm output had zero.

## What surprised us

**The hallucination gap was the biggest finding.** The cold agent fabricated 8 systems that don't exist. Not because the model is bad — because source code alone doesn't tell you what was intentionally removed, what's a design constraint, or what naming convention to follow.

Here's the knowledge gap that source code cannot fill:

| Knowledge | Without Tages | With Tages |
|-----------|--------------|------------|
| "worldGen.ts was deleted on purpose" | Never mentioned | Documented as design decision |
| "Message helpers exist because of 10 duplicates" | Described the functions | Explained the migration history |
| "Hemorrhagic shock is the ONLY combo" | Described it | Documented the design constraint |
| "CRT scanlines on inner div only" | Never mentioned | Documented with warning |
| "Stats were rebalanced from Wits" | Never mentioned | Documented the history |

Source code tells agents **what** exists. Memory tells them **why** it was built, **how** to work with it, and **what not to do**.

**The cost was negligible.** ~1,200 tokens of injected context per session. ~$0.003 at Claude API pricing. The quality improvement pays for itself by eliminating 3-4 revision cycles per task.

## Try it yourself

```bash
npm install -g tages
tages init
```

Two commands. Your AI tools now remember your codebase.

Tages is open source, works with Claude Code, Cursor, ChatGPT, Codex, Gemini — anything that speaks MCP.

- **Free**: 10,000 memories, full feature set
- **Self-hosted**: Everything free forever, bring your own Supabase

GitHub: https://github.com/ryantlee25-droid/tages

Full test data and raw outputs are in the `test-ab/` directory.

---

*Built by [Ryan Lee](https://github.com/ryantlee25-droid). Named after [Tages](https://en.wikipedia.org/wiki/Tages), the Etruscan divine child who appeared from a furrow in the earth and dictated sacred knowledge to scribes before vanishing. The knowledge persisted long after the source was gone.*
