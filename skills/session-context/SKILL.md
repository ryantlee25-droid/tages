---
name: session-context
description: "Load persistent codebase memory at session start. Automatically recalls project conventions, architecture decisions, and context from previous sessions. When an agent needs to: (1) Start a new session with full project context, (2) Recall what was learned in prior sessions, (3) Restore project memory, or (4) Initialize Tages for a new project. Gracefully offers setup if Tages isn't configured."
---

# Session Context — Restore Codebase Memory

## Keywords
session start, project context, recall, what do you know about this project, load context, restore memory, previous session, remember, what did we learn, project conventions, codebase memory

## Overview

Restore persistent codebase memory at the start of a session. Calls Tages MCP tools to hydrate the agent with conventions, architecture decisions, and project context from previous sessions. If Tages isn't configured for the current project, offers a smooth setup flow.

**Use this skill when:** Starting a new session, or when the user asks what you know about the project.

---

## Workflow

### Step 1: Hydrate Context

Call the brief tool to load a ranked, token-budgeted project context:

```
brief()
```

This returns the most important memories — gotchas, conventions, architecture decisions, and patterns — ranked by confidence, recency, and usage. High-value memories appear in full detail; lower-priority ones are summarized as compact key-value pairs. The token budget adapts to project size automatically.

### Step 2: Handle the Result

**Tool returns data (happy path):**

Absorb the returned brief into your working context. Summarize briefly to the user:

> Loaded project context — conventions, architecture decisions, and prior knowledge.

Do not dump the full memory contents unless asked. Use them silently to inform your work.

**Tools error — Tages not configured (setup path):**

If the tools fail because no Tages configuration exists for this project, offer setup:

> Tages isn't configured for this project yet. I can set it up so I'll remember conventions, architecture decisions, and context across sessions.
>
> - **Cloud** (recommended): `npx @tages/cli init` — syncs to dashboard, works across machines
> - **Local only**: `npx @tages/cli init --local` — SQLite only, no account needed
>
> Want me to set it up?

If the user says yes, run the appropriate init command. If no, proceed without memory and do not ask again this session.

**Tools succeed but return empty:**

> No memories stored yet for this project. I'll start remembering conventions and decisions as we work together.

### Step 3: Work Normally

With context loaded, proceed with whatever the user needs. The loaded memories inform your responses — you know the project's conventions, past decisions, and gotchas without the user having to re-explain them.

---

## Tips

- **Don't dump memories verbatim** — absorb them and use them naturally
- **Don't re-explain what the user already knows** — just work with the context
- **If a memory seems stale** — verify against current code before acting on it
- **If the user asks "what do you know"** — summarize the loaded memories concisely
