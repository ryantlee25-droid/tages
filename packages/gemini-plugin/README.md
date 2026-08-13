# @tages/gemini-plugin

Install Tages as an MCP server in Gemini CLI.

## One-line install

```bash
npx @tages/gemini-plugin
```

Writes `~/.gemini/settings.json` with a `tages` entry under `mcpServers`. If the file already exists, the installer merges into the existing `mcpServers` object and preserves all other top-level keys. Restart Gemini CLI; the Tages tools appear in the MCP tools panel.

## Options

| Flag | Behavior |
|---|---|
| (no flags) | Write to `~/.gemini/settings.json` |
| `--dry-run` | Print the config block to stdout instead of writing |
| `--force` | Overwrite an existing `"tages"` entry |
| `--help` | Show usage |

## Config block emitted

```json
{
  "mcpServers": {
    "tages": {
      "command": "npx",
      "args": ["-y", "@tages/server"],
      "env": {
        "TAGES_SUPABASE_URL": "",
        "TAGES_SUPABASE_ANON_KEY": "",
        "TAGES_PROJECT_ID": ""
      }
    }
  }
}
```

The `env` values are placeholders. Fill them in from your Tages project dashboard (`~/.config/tages/projects/<slug>.json` has the same values if you've already run `tages init`). Tages falls back to local-only mode when these are unset.

## Merge behavior

If `~/.gemini/settings.json` already exists and contains other keys (e.g. `theme`, `defaultModel`), the installer reads the file, sets `mcpServers.tages`, and writes the merged result back with 2-space indentation. No existing keys are lost.

## Related packages

- `@tages/server` — the MCP server (stdio transport) the plugin installs
- `@tages/cli` — command-line interface for managing memories outside Gemini
- `@tages/cursor-plugin` — equivalent plugin for Cursor

## License

MIT.
