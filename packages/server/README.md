# @tages/server

The MCP server for [Tages](https://github.com/ryantlee25-droid/tages) — team memory for AI coding agents.

This is the package your **agent** talks to. It speaks the [Model Context Protocol](https://modelcontextprotocol.io) over stdio and exposes Tages' memory tools (`remember`, `recall`, `forget`, `observe`, and the rest of a 56-tool surface) to any MCP-capable client: Claude Code, Cursor, Codex, Gemini CLI.

Reads are served from a local SQLite cache for sub-10ms lookups, with asynchronous sync to Supabase when cloud mode is configured.

## Install

You normally do not install this by hand — you register it as an MCP server and let your client run it with `npx`:

```bash
claude mcp add tages -- npx -y @tages/server
```

The [`@tages/cli`](https://www.npmjs.com/package/@tages/cli) `init` command and the editor plugins ([`@tages/cursor-plugin`](https://www.npmjs.com/package/@tages/cursor-plugin), [`@tages/codex-plugin`](https://www.npmjs.com/package/@tages/codex-plugin), [`@tages/gemini-plugin`](https://www.npmjs.com/package/@tages/gemini-plugin)) write the equivalent config for you.

## Configuration

The server runs local-only with zero configuration. For cloud and team mode, set:

| Variable | Purpose |
|---|---|
| `TAGES_SUPABASE_URL` | Supabase project URL |
| `TAGES_SUPABASE_ANON_KEY` | Supabase anon key |
| `TAGES_PROJECT_ID` | Project the agent should read and write |
| `TAGES_ENCRYPTION_KEY` | Optional AES-256-GCM encryption of memory values at rest |

A manual MCP entry looks like:

```json
{
  "mcpServers": {
    "tages": {
      "command": "npx",
      "args": ["-y", "@tages/server"],
      "env": { "TAGES_PROJECT_ID": "<uuid>" }
    }
  }
}
```

## Links

- [Repository and full documentation](https://github.com/ryantlee25-droid/tages)
- [Issues](https://github.com/ryantlee25-droid/tages/issues)

MIT licensed.
