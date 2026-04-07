# Codex Setup

Connect Tages to OpenAI Codex for persistent codebase memory.

## Prerequisites

- Node.js 20+

## Setup

### 1. Install

```bash
npm install -g @tages/cli
tages init
```

### 2. Configure Codex MCP

Add to your Codex MCP configuration:

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

Codex will automatically discover the Tages tools. Ask it to remember conventions, recall past decisions, or get context for files.
