# @tages/cli

Command-line interface for [Tages](https://github.com/ryantlee25-droid/tages) — team memory for AI coding agents.

Tages gives AI coding agents persistent, cross-session memory about a codebase: the conventions, decisions, architecture notes, and past mistakes that source code does not record. `@tages/cli` is the human-facing half. You use it to connect a project, write and read memories, wire Tages into your agent's MCP config, and manage team access. Your agent reads the same store through [`@tages/server`](https://www.npmjs.com/package/@tages/server).

## Install

```bash
npm install -g @tages/cli
```

> **Joining an existing team project?** Follow [`docs/team-onboarding.md`](https://github.com/ryantlee25-droid/tages/blob/main/docs/team-onboarding.md) rather than this install line. It is the authoritative setup path and explains which build to run for the team join flow.

## Usage

```bash
tages init                 # connect the current directory to a project
tages remember --type convention --value "API routes use snake_case"
tages recall "auth"        # search project memory
tages status               # project, memory count, sync state
tages doctor               # diagnose config, auth, and sync problems
```

`tages init` also writes the Tages MCP server into your agent's config, so Claude Code, Cursor, Codex, or Gemini CLI can read the same memories your team writes.

Other command groups: `link`, `forget`, `import`, `export`, `onboard`, `token`, `team`, `pending`, `verify`, `dedup`, `impact`, `risk`, `enforce`, `quality`, `templates`, `archive`, `federation`, `analytics`, `harness`. Run `tages --help` for the full list.

## Modes

- **Local-only** — memories live in a local SQLite cache. No account, no network.
- **Cloud/team** — backed by Supabase with RBAC, sharing, and a web dashboard.

## Links

- [Repository and full documentation](https://github.com/ryantlee25-droid/tages)
- [Issues](https://github.com/ryantlee25-droid/tages/issues)

MIT licensed.
