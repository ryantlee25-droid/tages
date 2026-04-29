# @tages/cursor-plugin

Install Tages as an MCP server in Cursor.

## One-line install

```bash
npx @tages/cursor-plugin
```

Writes `.cursor/mcp.json` in the current directory with a `tages` MCP server entry. Restart Cursor; the Tages tools appear in the MCP panel.

## Options

| Flag | Behavior |
|---|---|
| (no flags) | Write to `./.cursor/mcp.json` (project-scoped, recommended) |
| `--global` | Write to `~/.cursor/mcp.json` (applies to every project) |
| `--dry-run` | Print the config block to stdout instead of writing |
| `--force` | Overwrite an existing `"tages"` entry |
| `--help` | Show usage |

## Add to Cursor (one-click)

After publishing to the Cursor Directory, this section will include a `cursor://` deep-link button. For now, the `npx` one-liner above is the canonical install.

## Env vars

The plugin writes placeholder env values:

- `TAGES_SUPABASE_URL`
- `TAGES_SUPABASE_ANON_KEY`
- `TAGES_PROJECT_ID`

Fill them in from your Tages project dashboard (`~/.config/tages/projects/<slug>.json` has the same values if you've already run `tages init`). Tages falls back to local-only mode when these are unset, so you can start using memory immediately and add cloud sync later.

## Related packages

- `@tages/server` — the MCP server (stdio transport) the plugin installs
- `@tages/cli` — command-line interface for managing memories outside Cursor

## License

MIT.
