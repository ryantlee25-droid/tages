# Quickstart

## Fastest: MCP-Only (no install needed)

Add Tages to Claude Code with one command:

```bash
claude mcp add tages -- npx -y @tages/server
```

That's it. Open a new Claude Code session and your agent can now `remember` and `recall` codebase context.

> Memories are stored locally in SQLite. No account needed. No cloud sync.

## Full Install (with CLI)

For the full experience including CLI commands, dashboard, and cloud sync:

```bash
npm install -g @tages/cli
cd your-project
tages init
```

This defaults to cloud mode (GitHub OAuth + sync). Use `--local` to skip auth and store memories locally only.

> **Free tier** includes 20 core MCP tools (remember, recall, forget, conventions, architecture, decisions, brief, pre-check, and more). Pro adds 36 advanced tools: federation, analytics, impact analysis, quality scoring, and templates. [Compare plans ->](https://tages.ai/pricing)

## Store your first memory

```bash
tages remember "api-error-format" "All API routes return { error, code, status }" --type convention
```

## Recall it

```bash
tages recall "error format"
```

## Use with Claude Code

Open Claude Code in your project. The MCP tools are already configured. Ask Claude to recall project conventions — it'll find what you stored.

## Commands

| Command | Description |
|---------|-------------|
| `tages init` | Initialize for current project |
| `tages init --local` | Local-only mode (no cloud) |
| `tages remember <key> <value>` | Store a memory |
| `tages recall <query>` | Search memories |
| `tages forget <key>` | Delete a memory |
| `tages status` | Show project stats |
| `tages dashboard` | Open web dashboard |

## Memory types

Use `--type` to categorize: `convention`, `decision`, `architecture`, `entity`, `lesson`, `preference`, `pattern`.
