# Cursor Setup

Connect Tages to Cursor for persistent codebase memory.

## Prerequisites

- Node.js 20+
- Cursor installed

## Install (one line)

```bash
npx @tages/cursor-plugin
```

This writes `.cursor/mcp.json` in the current directory with a `tages` MCP server entry. Restart Cursor; the Tages tools appear in the MCP panel.

### Global install (apply to every project)

```bash
npx @tages/cursor-plugin --global
```

Writes to `~/.cursor/mcp.json`. Project-scoped entries override global ones.

### Preview before writing

```bash
npx @tages/cursor-plugin --dry-run
```

## Manual config

If you prefer to edit the file yourself, add this to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "tages": {
      "command": "npx",
      "args": ["-y", "@tages/server"],
      "env": {
        "TAGES_SUPABASE_URL": "your-supabase-url",
        "TAGES_SUPABASE_ANON_KEY": "your-anon-key",
        "TAGES_PROJECT_ID": "your-project-id"
      }
    }
  }
}
```

Fill env values from your Tages project config (`~/.config/tages/projects/<slug>.json` after `tages init`). Leave them empty to run Tages in local-only mode using the SQLite cache.

## Verify

Open Cursor, open the MCP tools panel. Tages tools should appear under `tages`. From a chat, ask:

> Use the tages `recall` tool to find memories about the current file.

## Troubleshooting

- **No tools appear:** restart Cursor after editing `.cursor/mcp.json`.
- **Server errors on startup:** run `npx @tages/server --help` directly to check for missing env vars or network issues.
- **Cursor can't find `npx`:** ensure Node.js is on your `PATH` in Cursor's launch environment.
