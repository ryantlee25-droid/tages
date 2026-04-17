# Quickstart

## Fast Start From a Shared Downloads Folder

If someone sends you a Tages handoff folder, you can use it right away.

1. Put the folder in `Downloads`.
2. Open the file that ends with `-local-dashboard.html`.
3. Click `Continue` on the memory block you want to resume from.

### Chrome

1. Open Chrome.
2. Press `Ctrl+O` (`Cmd+O` on Mac).
3. Pick the `-local-dashboard.html` file from `Downloads`.

### Firefox

1. Open Firefox.
2. Press `Ctrl+O` (`Cmd+O` on Mac).
3. Pick the `-local-dashboard.html` file from `Downloads`.

No extension install is required for this flow.

## Fastest: MCP-Only (no install needed)

Add Tages to Claude Code with one command:

```bash
claude mcp add tages -- npx -y @tages/server
```

That's it. Open a new Claude Code session and your agent can now `remember` and `recall` codebase context.

> Memories are stored locally in SQLite. No account needed. No cloud sync.

## Full Install (with CLI)

For the full experience including CLI commands, dashboard, and cloud sync:

```bash
npm install -g @tages/cli
cd your-project
tages init
```

This defaults to cloud mode (GitHub OAuth + sync). Use `--local` to skip auth and store memories locally only.

> **Free tier** includes 20 core MCP tools (remember, recall, forget, conventions, architecture, decisions, brief, pre-check, and more). Pro adds 36 advanced tools: federation, analytics, impact analysis, quality scoring, and templates. [Compare plans ->](https://tages.ai/pricing)

## Store your first memory

```bash
tages remember "api-error-format" "All API routes return { error, code, status }" --type convention
```

## Recall it

```bash
tages recall "error format"
```

## Start a new chat without losing continuity

```bash
tages session save --objective "Continue Veil of the Towers arc" --label "Veil of the Towers" --tags provider:chatgpt
tages session load
```

Paste the `tages session load` output into the first message of your new chat to rehydrate context.

For a click-first flow in the web dashboard:

1. Open your project page.
2. Use **Session Handoff**.
3. Click `Save Handoff`, then later `Load Handoff`, then `Copy Restore Block`.

For a local shortcut flow, open the local browser dashboard:

```bash
tages dashboard --local-view --install-shortcut
```

This creates a clickable shortcut in your current folder (Windows `.url`, macOS `.command`) and opens local handoff/provider blocks with a one-click Continue action.

## Use with Claude Code

Open Claude Code in your project. The MCP tools are already configured. Ask Claude to recall project conventions — it'll find what you stored.

## Commands

| Command | Description |
|---------|-------------|
| `tages init` | Initialize for current project |
| `tages init --local` | Local-only mode (no cloud) |
| `tages remember <key> <value>` | Store a memory |
| `tages recall <query>` | Search memories |
| `tages handoff [focus]` | Build a continuity handoff for a new chat |
| `tages session save [input]` | Save short-lived session handoff state |
| `tages session load` | Rehydrate latest handoff into prompt-ready context |
| `tages forget <key>` | Delete a memory |
| `tages status` | Show project stats |
| `tages dashboard` | Open web dashboard |

## Memory types

Use `--type` to categorize:
`convention`, `decision`, `architecture`, `entity`, `lesson`, `preference`, `pattern`, `execution`, `operational`, `environment`, `anti_pattern`.
