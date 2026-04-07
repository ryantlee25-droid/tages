# Quickstart

Get Tages running in under 5 minutes.

## 1. Install

```bash
npm install -g @tages/cli
```

## 2. Initialize

```bash
cd your-project
tages init
```

Follow the GitHub OAuth prompt in your browser.

## 3. Store your first memory

```bash
tages remember "api-error-format" "All API routes return { error, code, status }" --type convention
```

## 4. Recall it

```bash
tages recall "error format"
```

## 5. Use with Claude Code

Open Claude Code in your project. The MCP tools are already configured. Ask Claude to recall project conventions — it'll find what you stored.

## Commands

| Command | Description |
|---------|-------------|
| `tages init` | Initialize for current project |
| `tages init --local` | Local-only mode (no cloud) |
| `tages remember <key> <value>` | Store a memory |
| `tages recall <query>` | Search memories |
| `tages forget <key>` | Delete a memory |
| `tages status` | Show project stats |
| `tages dashboard` | Open web dashboard |

## Memory types

Use `--type` to categorize: `convention`, `decision`, `architecture`, `entity`, `lesson`, `preference`, `pattern`.
