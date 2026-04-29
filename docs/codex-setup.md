# Codex Setup

Connect Tages to OpenAI Codex for persistent codebase memory.

## Prerequisites

- Node.js 20+
- Codex CLI installed

## Install via plugin (recommended)

```bash
npx @tages/codex-plugin
```

Appends a `[mcp_servers.tages]` block to `~/.codex/config.toml`. Use `--dry-run` to preview the block before writing.

## Install via Codex CLI

```bash
codex mcp add tages -- npx -y @tages/server
```

Both paths write the same config.

## Manual setup

If you'd rather hand-edit `~/.codex/config.toml`:

```toml
[mcp_servers.tages]
command = "npx"
args = ["-y", "@tages/server"]

[mcp_servers.tages.env]
TAGES_SUPABASE_URL = "your-supabase-url"
TAGES_SUPABASE_ANON_KEY = "your-anon-key"
TAGES_PROJECT_ID = "your-project-id"
```

## Usage

Restart Codex after installing. The Tages tools appear alongside other MCP tools — ask Codex to remember conventions, recall past decisions, or get context for files.

Run `tages init` (from `@tages/cli`) to create a project and populate the env values.
