# Cursor Setup

Connect Tages to Cursor for persistent codebase memory.

## Prerequisites

- Node.js 20+
- Cursor installed

## Setup

### 1. Install

```bash
npm install -g @tages/cli
tages init
```

### 2. Configure Cursor MCP

Add to your Cursor MCP config (`.cursor/mcp.json` in your project root):

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

You can find your project config values in `~/.config/tages/projects/<slug>.json`.

### 3. Verify

Open Cursor and use the MCP tools panel to verify the 7 Tages tools appear.
