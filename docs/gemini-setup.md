# Gemini Setup

Connect Tages to Google Gemini for persistent codebase memory.

## Prerequisites

- Node.js 20+
- Gemini with MCP support

## Install via plugin

The fastest way to configure Gemini is with the one-line installer:

```bash
npx @tages/gemini-plugin
```

This writes the `tages` MCP server entry to `~/.gemini/settings.json`. If the file already exists, the installer merges into the existing `mcpServers` object and preserves all other top-level keys.

Available flags:

| Flag | Behavior |
|---|---|
| (no flags) | Write to `~/.gemini/settings.json` |
| `--dry-run` | Print the config block to stdout instead of writing |
| `--force` | Overwrite an existing `"tages"` entry |
| `--help` | Show usage |

After running the plugin, restart Gemini CLI. The Tages MCP tools appear automatically.

---

## Manual setup

### 1. Install

```bash
npm install -g @tages/cli
tages init
```

### 2. Configure MCP

Add the Tages server to your Gemini MCP configuration:

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

### 3. Usage

Gemini will discover the 7 Tages tools automatically. Use `remember` to store context, `recall` to search, and `conventions`/`architecture`/`decisions` to browse by type.
