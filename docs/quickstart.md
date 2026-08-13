# Quickstart

This is the path for **creating a new project**. Joining a project a teammate already made? Use [Team Onboarding](team-onboarding.md) — the commands are different, and running `tages init` to join is a documented trap.

## 1. Install from source

The published npm packages are stale — `@tages/cli` is **0.2.1** (April) and `@tages/server` is **0.1.1**. Neither matches this repo. Build from source:

```bash
git clone https://github.com/ryantlee25-droid/tages.git ~/src/tages
cd ~/src/tages
pnpm install --frozen-lockfile
pnpm -r build
cd packages/cli && pnpm link --global
```

Link from `packages/cli`, not the repo root — the root package is private and exposes no `tages` binary.

```bash
tages --version
# 0.3.0
```

Keep the clone. Your agent gets wired to the server built inside it, so deleting or un-building it breaks your setup.

## 2. Initialize in your project

`tages init` writes `.mcp.json` into **the current directory**, so run it from the repo you actually work in — never from the tages clone.

```bash
cd ~/work/my-project
tages init
```

Cloud mode is the default: it runs GitHub OAuth, creates a project named after the directory, writes `.mcp.json` (pointed at your local server build) plus a `.tages/config.json` marker, adds `.mcp.json` to `.git/info/exclude`, and installs a `post-commit` hook.

| Flag | Effect |
|---|---|
| `--local` | Local-only. No auth, no cloud sync. |
| `--slug <slug>` | Project slug (defaults to the directory name). |
| `--team` | Cloud mode, then prompts for teammate emails. |

> **If `init` fails with "Free tier is limited to 2 projects", check the slug first.** Slugs are globally unique across *all* owners, so if anyone anywhere already owns that slug, the insert fails and the error is misreported as a plan limit. It is usually not a billing problem. Retry with `tages init --slug <something-unique>`.

Then restart Claude Code in the project so it picks up `.mcp.json`, approving the project-scoped server if prompted.

## 3. Store your first memory

```bash
tages remember "api-error-format" "All API routes return { error, code, status }" --type convention
```

A green `Stored:` means it reached the cloud. A yellow `Stored locally only:` means it is in local SQLite and no teammate will see it — note that the command still exits `0`.

## 4. Recall it

```bash
tages recall "error format"
```

`tages recall` always queries the cloud directly, so it is the fastest way to check what is really stored.

## 5. Use with Claude Code

Open Claude Code in your project. The MCP tools are already configured by `init`. Ask Claude to recall project conventions and it will find what you stored.

Note that the MCP tools read a local cache that is hydrated only at server start. A memory a teammate writes now will not reach your agent until you restart the session — there is no periodic pull and no `tages pull`. See [Team Onboarding](team-onboarding.md#there-is-no-periodic-pull--restart-to-see-a-teammates-memory).

## Commands

| Command | Description |
|---|---|
| `tages init` | Create a project for the current directory |
| `tages init --local` | Local-only mode (no cloud) |
| `tages link --project-id <uuid>` | Join a project a teammate already created |
| `tages remember <key> <value>` | Store a memory |
| `tages recall <query>` | Search memories (always live) |
| `tages forget <key>` | Delete a memory |
| `tages status` | Project stats, including the project `ID:` |
| `tages onboard` | Structured project briefing from stored memories |
| `tages doctor` | Health check (see caveat below) |
| `tages dashboard` | Open the dashboard in your browser |
| `tages team invite <email> --role admin` | Invite a teammate who can write |

Full list: `tages --help`. There is no `pull`, `sync`, or `fetch` command.

> `tages doctor`'s "MCP server config" check only inspects the two Claude *Desktop* config paths, not the `.mcp.json` that `init` writes. It reports "not found" on a correct setup. Use `cat .mcp.json` instead.

## Memory types

Pass one to `--type` (defaults to `convention`). There are 11, defined in `packages/shared/src/types.ts`:

`convention`, `decision`, `architecture`, `entity`, `lesson`, `preference`, `pattern`, `execution`, `operational`, `environment`, `anti_pattern`

## MCP tools

The free tier exposes **20** tools:

`remember`, `recall`, `forget`, `conventions`, `architecture`, `decisions`, `context`, `staleness`, `conflicts`, `stats`, `observe`, `session_end`, `verify_memory`, `pending_memories`, `pre_check`, `project_brief`, `file_recall`, `import_claude_md`, `import_memories`, `memory_history`

Pro adds **36** more (federation, analytics, impact analysis, quality scoring, templates, archival) for **56** total. [Compare plans →](https://app.tages.ai/pricing)

Tool names use underscores: it is `project_brief` and `pre_check`, not `brief` or `pre-check`. Note that `tages brief` *is* a real CLI command, but it generates a cached brief file and is a different thing from the `project_brief` MCP tool.

## Inviting teammates

Send invites **from the dashboard** (`https://app.tages.ai/app/projects/<slug>/settings`). The dashboard route sends a real magic-link email; `tages team invite` only writes a pending row and notifies nobody, so you would have to tell the person yourself before the row expires in 30 days.

Invite teammates as **`admin`**, not the default `member` — a `member` can read but every write silently fails to sync. Free tier is the owner plus 2 teammates.

Give each teammate the project UUID from `tages status` (`ID:` line) or the dashboard settings page, and point them at [Team Onboarding](team-onboarding.md).
