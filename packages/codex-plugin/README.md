# @tages/codex-plugin

Install Tages as an MCP server in OpenAI Codex.

## One-line install

```bash
npx @tages/codex-plugin
```

Appends a `[mcp_servers.tages]` block to `~/.codex/config.toml`. Restart Codex; the Tages tools are available.

## Options

| Flag | Behavior |
|---|---|
| (no flags) | Append to `~/.codex/config.toml` |
| `--dry-run` | Print the TOML block to stdout instead of writing |
| `--force` | Append even if a `[mcp_servers.tages]` block already exists (may create duplicate entries; manual cleanup needed) |
| `--help` | Show usage |

## Alternative install (uses Codex's own MCP command)

If you prefer Codex's built-in installer:

```bash
codex mcp add tages -- npx -y @tages/server
```

Either path produces the same configuration. The plugin is useful when you want a dry-run preview or when you want to install without invoking the Codex CLI.

## Env vars

The plugin writes placeholder env values:

- `TAGES_SUPABASE_URL`
- `TAGES_SUPABASE_ANON_KEY`
- `TAGES_PROJECT_ID`

Fill them in from your Tages project dashboard (`~/.config/tages/projects/<slug>.json` has the same values if you've already run `tages init`). Tages falls back to local-only mode when these are unset.

## Related packages

- `@tages/server` — the MCP server (stdio transport) this plugin installs
- `@tages/cli` — command-line interface for managing memories outside Codex
- `@tages/cursor-plugin`, `@tages/gemini-plugin` — sibling installers for other agents

## License

MIT.
