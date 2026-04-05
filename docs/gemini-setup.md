# Gemini Setup

Connect Tages to Google Gemini for persistent codebase memory.

## Prerequisites

- Node.js 20+
- Gemini with MCP support

## Setup

### 1. Install

```bash
npm install -g tages
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
