---
name: proactive-memory
description: "Proactively remember project conventions, architecture decisions, gotchas, and corrections during normal coding work. When an agent: (1) Discovers a naming convention or code pattern, (2) Learns why something is built a certain way, (3) Encounters a non-obvious gotcha or workaround, (4) Gets corrected by the user on approach or style. Captures valuable context so future sessions don't start from scratch."
---

# Proactive Memory — Remember as You Work

## Keywords
remember this, save convention, note this pattern, don't forget, save this decision, remember for next time, keep this in mind, convention, architecture decision, gotcha, correction

## Overview

During normal coding work, capture valuable project knowledge into Tages so it persists across sessions. This skill guides when and what to remember — the goal is that the next session starts with full context instead of amnesia.

**Use this skill when:** You discover something worth remembering during coding, or the user explicitly asks you to remember something.

---

## What to Remember

### Conventions
Naming patterns, code style, file organization, import conventions, test patterns.

**Examples:**
- "Components in this project use PascalCase with a `.component.tsx` suffix"
- "All API routes validate input with Zod schemas before processing"
- "Tests use factories from `tests/factories/` instead of inline fixtures"

### Architecture Decisions
Why something is built a certain way, trade-offs that were made, structural choices.

**Examples:**
- "Auth uses Supabase PKCE flow with a /auth/cli-token workaround for CLI OAuth"
- "SQLite is the primary store for sub-10ms reads; Supabase syncs in background"
- "Dashboard deploys manually via `vercel --prod`, not auto-deploy from GitHub"

### Gotchas
Non-obvious behavior, common mistakes, workarounds, things that look wrong but are intentional.

**Examples:**
- "Supabase `.from().insert()` returns PromiseLike not Promise — wrap with Promise.resolve() for .catch()"
- "The ESM/CJS boundary between CLI and server requires createRequire + directory walk"
- "Migration params need explicit `::uuid` cast for uuid columns"

### Corrections
When the user corrects your approach — remember it so you don't repeat the mistake.

**Examples:**
- User: "No, we don't mock the database in these tests" → Remember: integration tests use real DB
- User: "Use the existing Button component, don't create a new one" → Remember: reuse shared components from `src/components/ui/`

---

## What NOT to Remember

- **Ephemeral task details** — current bug description, in-progress work status
- **File contents or code** — derivable from reading the codebase
- **Debugging steps** — not reusable across sessions
- **Anything in CLAUDE.md or README** — already persisted and loaded automatically
- **Obvious language/framework behavior** — only project-specific knowledge

---

## How to Remember

When you identify something worth capturing, call the `remember` tool:

```
remember(
  key: "descriptive-short-name",
  value: "The thing to remember — clear, specific, actionable",
  category: "convention" | "architecture" | "decision" | "gotcha",
  context: "Why this matters or when it applies"
)
```

Then briefly inform the user:

> Remembered: [key]

Keep it short. Don't interrupt the flow of work to celebrate remembering something.

---

## When to Remember

**Do remember when:**
- You discover a pattern after reading multiple files ("ah, all services follow this structure")
- The user corrects you ("no, we do X not Y")
- You hit a gotcha that wasted time ("this API doesn't work the way you'd expect")
- The user explicitly says "remember this" or "note this for next time"
- You make an architecture decision together ("let's use approach B because...")

**Don't remember when:**
- You're unsure if it's a convention or a one-off
- The information is already stored (check with `recall` first if uncertain)
- It's generic knowledge, not project-specific
- The user is brainstorming and hasn't decided yet

---

## Judgment Calls

Not everything needs to be remembered. Use judgment:

- **High value:** Patterns that affect multiple files, decisions that took discussion to reach, gotchas that caused debugging time
- **Low value:** Minor preferences, single-file details, things that are obvious from reading the code
- **When uncertain:** Lean toward remembering. It's easier to forget (clean up) later than to re-discover something lost.
