# Tages Claude Code Plugin — Design Spec

**Date:** 2026-04-10
**Status:** Approved
**Author:** Ryan Lee + Claude

## Goal

Package the Tages MCP server as a Claude Code plugin so users can install it with `/plugin` and get persistent codebase memory with zero manual setup.

## Structure

```
(repo root)
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── .mcp.json                # MCP server launch config
└── skills/
    ├── session-context/
    │   └── SKILL.md         # Session-start context hydration
    └── proactive-memory/
        └── SKILL.md         # Ambient convention/decision capture
```

These files live in the Tages monorepo root alongside existing packages.

## Plugin Manifest (`.claude-plugin/plugin.json`)

```json
{
  "name": "tages",
  "description": "Persistent codebase memory for AI coding agents. Automatically remembers conventions, architecture decisions, and project context across sessions.",
  "version": "0.1.0",
  "author": { "name": "Ryan Lee" },
  "homepage": "https://tages.ai",
  "repository": "https://github.com/ryantlee25-droid/tages",
  "license": "MIT",
  "keywords": ["memory", "context", "mcp", "codebase", "conventions"],
  "mcpServers": "../.mcp.json",
  "skills": "../skills/"
}
```

## MCP Server Config (`.mcp.json`)

```json
{
  "mcpServers": {
    "tages": {
      "command": "npx",
      "args": ["@tages/server"]
    }
  }
}
```

Zero-install: `npx` downloads `@tages/server` on first run. Users who want faster startup can `npm i -g @tages/server`.

## Skill 1: `session-context`

**Purpose:** Hydrate Claude Code with project context at session start.

**Trigger keywords:** session start, project context, recall, what do you know about this project, load context, restore memory

**Behavior:**

1. Call `recall`, `conventions`, `architecture`, `decisions` in parallel
2. **Success path:** Tools return data. Summarize to user: "Loaded N memories for this project (conventions, architecture, decisions)."
3. **Error path (no config):** Tools fail because Tages isn't initialized. Offer setup:
   - "Tages isn't configured for this project yet. Want me to set it up?"
   - If yes: guide through `npx @tages/cli init` (cloud, default) or `npx @tages/cli init --local` (local-only)
   - If no: proceed without memory, don't ask again this session
4. **Empty path:** Tools succeed but return no memories. Inform user: "No memories stored yet for this project. I'll start remembering as we work."

**Does not:** Auto-run without being triggered. The skill is available for session-start use but doesn't force itself.

## Skill 2: `proactive-memory`

**Purpose:** Guide Claude Code to remember valuable context during normal work.

**Trigger keywords:** remember this, save convention, note this pattern, don't forget, save this decision, remember for next time

**What to remember (categories):**

- **Conventions** — naming patterns, code style, file organization, import patterns
- **Architecture decisions** — why something is built a certain way, trade-offs made
- **Gotchas** — non-obvious behavior, common mistakes, workarounds
- **Corrections** — when the user corrects Claude Code's approach ("no, we do it this way")

**What NOT to remember:**

- Ephemeral task details (current bug, in-progress work)
- File contents or code (derivable from codebase)
- Debugging steps (not reusable across sessions)
- Anything already in CLAUDE.md or README

**Behavior:**

1. When Claude Code discovers something worth remembering during normal work, call `remember` with:
   - `category`: convention | architecture | decision | gotcha
   - `key`: descriptive short name
   - `value`: the thing to remember
   - `context`: why this matters
2. Inform user briefly: "Remembered: [key]"
3. When user explicitly says "remember this" — capture what they're referring to

## What's NOT in the plugin

- **No maintenance skills** — dedup, archive, quality, federation, staleness, templates, branches are power-user CLI features. Users access them via MCP tools directly or via `tages` CLI.
- **No hooks** — skills are sufficient for the two core behaviors.
- **No CLAUDE.md injection** — the plugin operates through skills + MCP tools only.
- **No session-end skill** — considered but excluded. Auto-summarizing at session end is opinionated and can be noisy. Users who want it can call `session_end` directly.

## Distribution

The plugin is a git repo. Users install via:

```
/plugin https://github.com/ryantlee25-droid/tages
```

Or if Claude Code supports a plugin registry, by name:

```
/plugin tages
```

## Success Criteria

1. User installs plugin, starts a session — `session-context` skill loads existing memories or offers setup
2. During coding, `proactive-memory` skill captures conventions and decisions without being asked
3. Next session, `session-context` restores everything — no amnesia
4. Uninitiated projects get a smooth setup offer, not an error
