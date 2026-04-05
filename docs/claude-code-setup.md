# Claude Code Setup

Connect Tages to Claude Code so your AI sessions remember your codebase.

## Prerequisites

- Node.js 20+
- Claude Code installed and configured

## Setup

### 1. Install Tages

```bash
npm install -g tages
```

### 2. Initialize in your project

```bash
cd your-project
tages init
```

This will:
- Open your browser for GitHub authentication
- Create a project config at `~/.config/tages/projects/<slug>.json`
- Add the Tages MCP server to Claude Code's config

### 3. Verify

Open Claude Code and check that the Tages MCP tools are available:

```
> /mcp
```

You should see 7 Tages tools:
- `remember` — Store a memory
- `recall` — Search memories
- `forget` — Delete a memory
- `conventions` — List conventions
- `architecture` — List architecture notes
- `decisions` — List decisions
- `context` — Get context for a file

### Local-only mode

If you don't want cloud sync:

```bash
tages init --local
```

Memories are stored in a local SQLite database at `~/.config/tages/cache/<slug>.db`.

## How it works

Claude Code connects to the Tages MCP server via stdio. When you (or Claude) store a memory, it's saved to both a local SQLite cache and Supabase. When you start a new session, Claude can recall past decisions, conventions, and architecture notes instantly.

## MCP server config

The MCP entry in your Claude Code config looks like:

```json
{
  "mcpServers": {
    "tages": {
      "command": "npx",
      "args": ["-y", "@tages/server"]
    }
  }
}
```

Config file locations:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/claude/claude_desktop_config.json`
