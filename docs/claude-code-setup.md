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

## End-of-session workflow

Tages can automatically capture codebase learnings at the end of each session.

### What belongs in Tages vs. local memory

| Store in Tages | Keep in local memory |
|---|---|
| Codebase conventions, decisions, architecture | Personal workflow preferences |
| Bug patterns and gotchas | Claude Code behavior settings |
| Build/deploy/runtime patterns | Session-specific task tracking |

### Manual wrap-up

Run at the end of a session to extract and store learnings:

```bash
tages session-wrap
```

This prompts you for a freeform summary. Tages extracts memories by keyword:
- "decided" / "chose" → **decision**
- "convention" / "always" / "never" → **convention**
- "architecture" / "module" / "structure" → **architecture**
- "learned" / "gotcha" / "bug" → **lesson**
- "created" / "added" / "built" → **entity**

You can also pass a summary directly:

```bash
tages session-wrap --summary "Decided to use Zod for validation. Learned that Supabase returns PromiseLike not Promise."
```

### Automatic hook (Claude Code)

Add a `SessionEnd` hook to your Claude Code settings so learnings are persisted automatically. Add this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "tages session-wrap --non-interactive"
          }
        ]
      }
    ]
  }
}
```

In non-interactive mode, the command reads `~/.config/tages/pending-session-notes.txt` if it exists, extracts memories, and deletes the file. If no file exists, it exits silently.

To pre-stage notes for the hook, write to the pending file during your session:

```bash
echo "Decided to use ILIKE fallback for search" >> ~/.config/tages/pending-session-notes.txt
```
