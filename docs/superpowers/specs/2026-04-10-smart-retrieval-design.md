# Smart Retrieval Layer — Design Spec

**Date:** 2026-04-10
**Status:** Approved
**Author:** Ryan Lee + Claude

## Goal

Upgrade `tages brief` from "dump everything by type" to a ranked, token-budgeted, tiered-format context generator. The `session-context` plugin skill calls `brief` as its single entry point instead of 4 separate tools.

## Problem

The current approach injects all memories every time, which:
1. Blows the token budget for any real codebase (200+ memories = 20K+ tokens raw)
2. Drowns high-value memories in noise — a critical gotcha sits next to a minor preference
3. Wastes tool calls — the plugin skill fires 4 parallel calls (`recall` + `conventions` + `architecture` + `decisions`) with no coordination

## Solution

Three improvements to `tages brief`, plus a skill update:

### 1. Static Ranking Within Sections

Score each memory with a composite formula:

```
score = confidence × 0.4 + recency × 0.3 + accessFrequency × 0.3
```

- **Confidence**: already 0-1 in the database
- **Recency**: normalized 0-1 where 1 = updated today, 0 = updated 90+ days ago. Formula: `max(0, 1 - daysSinceUpdate / 90)`
- **Access frequency**: normalized 0-1 relative to the project's most-accessed memory. Formula: `access_count / max_access_count` (or 0 if max is 0)

Sort memories within each type section by composite score descending. This is deterministic, fast (no embeddings), and works in local-only mode.

### 2. Adaptive Token Budget

Default `maxTokens` scales with project memory count:

| Memories | Default Budget |
|----------|---------------|
| < 50     | 4,000 tokens  |
| 50-200   | 6,000 tokens  |
| 200+     | 8,000 tokens  |

The `maxTokens` parameter is still overridable by the caller. Token estimation continues to use `Math.ceil(text.length / 4)`.

### 3. Tiered Output Format

Within each type section, memories are split into two tiers based on their ranking score:

**Top tier** (top 20% by score within the section, minimum 3 memories): Full format with key, value, and context preserved.

```
## Conventions (critical)
- **supabase-promiselike**: Supabase .from().insert() returns PromiseLike not
  Promise — wrap with Promise.resolve() for .catch(). Discovered when error
  handling silently swallowed failures in the sync layer.
```

**Compact tier** (remaining memories): Key-value one-liners, stripped of narrative.

```
## Conventions
esm-cjs-import: createRequire + dir walk for ESM→CJS
pkce-cli-auth: Use /auth/cli-token workaround for Supabase PKCE
uuid-cast: Migration params need explicit ::uuid cast
```

Section priority order is unchanged: gotchas → integration recipes → conventions → architecture → decisions → remaining types. Sections that don't fit in the remaining budget are dropped entirely, lowest priority first.

### 4. Session-Context Skill Update

Replace 4 parallel tool calls with a single call:

```
brief(maxTokens: <adaptive default>)
```

The skill consumes the brief output as context and summarizes: "Loaded N memories for this project."

## Architecture

### New file: `packages/server/src/search/memory-scorer.ts`

Pure function, no side effects, no imports beyond types:

```typescript
interface ScoredMemory {
  memory: Memory
  score: number
}

function scoreMemory(memory: Memory, maxAccessCount: number): number
function scoreAndSort(memories: Memory[]): ScoredMemory[]
```

### Modified file: `packages/server/src/tools/brief.ts`

Changes:
1. Import and call `scoreAndSort()` instead of using raw `getAllForProject()` order
2. Compute adaptive `maxTokens` default from memory count
3. Split each section into top-tier (full format) and compact-tier (key-value)
4. Apply token budget with tiered formatting

### Modified file: `skills/session-context/SKILL.md`

Replace the 4-tool parallel call instruction with a single `brief` call.

## What's NOT Changing

- The `recall` tool — still available for on-demand search during sessions
- `contextual_recall` — still available for file-path-aware queries
- The ranker in `search/ranker.ts` — untouched, only used by recall
- Brief section priority ordering — already correct
- Brief auto-formatting (code detection, gotcha imperatives) — already good
- Token estimation formula (`chars / 4`) — adequate for budgeting
- The `maxTokens` parameter on `brief` — still works, just has a smarter default

## Success Criteria

1. `brief` output for a 100-memory project fits in ~4K-6K tokens (vs. unbounded today)
2. Top-ranked memories appear in full format; low-value memories compressed to one-liners
3. `session-context` skill makes 1 tool call instead of 4
4. Existing `brief` tests still pass
5. New tests cover: scoring formula, adaptive budget selection, tier splitting, format output
