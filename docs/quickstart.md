# Quickstart

This is the path for **creating a new project**. Joining a project a teammate already made? Use [Team Onboarding](team-onboarding.md) — the commands are different, and running `tages init` to join is a documented trap.

## 1. Install from npm

```bash
npm install -g @tages/cli
tages --version
# 0.5.4
```

That is the whole install. The published packages are current — `@tages/cli` 0.5.4, `@tages/server` 0.3.4, `@tages/shared` 0.2.2 — and the end-to-end suite gates every release against the **published** artifacts, not the source tree, so npm is the path that is actually tested.

Your agent is wired to `npx -y @tages/server`, which needs no clone. Nothing to keep on disk, nothing to rebuild.

<details>
<summary>Building from source instead (only if you are developing Tages itself)</summary>

```bash
git clone https://github.com/ryantlee25-droid/tages.git ~/src/tages
cd ~/src/tages
pnpm install --frozen-lockfile
pnpm -r build
cd packages/cli && pnpm link --global
```

Link from `packages/cli`, not the repo root — the root package is private and exposes no `tages` binary. With a built clone present, `init` and `link` prefer that local server over the npm one and say so in their output. Keep the clone: deleting or un-building it then breaks your setup.

</details>

## 2. Initialize in your project

`tages init` writes `.mcp.json` into **the current directory**, so run it from the repo you actually work in — never from the tages clone.

```bash
cd ~/work/my-project
tages init
```

Cloud mode is the default. It reuses your saved session if you have one (only opening a browser for GitHub OAuth when you don't), creates a project named after the directory, writes `.mcp.json` — pointed at `npx -y @tages/server`, or at a local build if you have a built clone — plus a `.tages/config.json` marker, adds `.mcp.json` to `.git/info/exclude`, and installs a `post-commit` hook.

> **The post-commit hook indexes your commits.** It runs `tages index --last-commit` in the background after every commit, extracting memories from the diff. With Ollama running it uses that; otherwise with `ANTHROPIC_API_KEY` set it sends the diff to the Anthropic API; with neither it falls back to `dumb` mode (file paths only, nothing leaves your machine). **On a proprietary codebase, decide which of those you want before you export an API key.** Remove the hook with `rm .git/hooks/post-commit`.

| Flag | Effect |
|---|---|
| `--local` | Local-only. No auth, no cloud sync. |
| `--slug <slug>` | Project slug (defaults to the directory name). |
| `--team` | Cloud mode, then prompts for teammate emails. |

> **Free tier allows exactly 1 project.** The RLS policy is `is_pro(uid) OR (projects you own) < 1` (`supabase/migrations/0002_rls_policies.sql`). A second project on a free account is refused. Pro allows more; team seats are `LEAST(subscription_quantity, 20)`.
>
> **If `init` reports the slug is already taken, it is not a billing problem.** Slugs are globally unique across *all* owners, so if anyone anywhere already owns that slug the insert fails. Retry with `tages init --slug <something-unique>`, or use `tages link --project-id <uuid>` if you meant to join that project rather than create one.

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

**The CLI and your agent see teammate writes on different schedules.**

- **CLI commands pull.** Every memory command reconciles first — push your dirty rows, then pull remote state (`packages/cli/src/sync/cli-sync.ts`). `tages recall` additionally queries the cloud directly. So a terminal command sees a teammate's memory immediately.
- **The MCP tools do not.** The server hydrates its local cache once at boot (`packages/server/src/index.ts`); its 60s timer only flushes upward. **Your agent will not see a teammate's new memory until you restart the Claude Code session.**

There is still no `tages pull` command — the reconcile is automatic, not something you invoke. See [Team Onboarding](team-onboarding.md#there-is-no-periodic-pull--restart-to-see-a-teammates-memory).

## Commands

| Command | Description |
|---|---|
| `tages login` | Sign in (or switch accounts). **This is the fix for an expired session — never `init`.** |
| `tages whoami` | Show the signed-in identity |
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

Full list: `tages --help`. There is no `pull`, `sync`, or `fetch` command — CLI commands reconcile automatically.

> `tages doctor` probes the project-scoped `.mcp.json` **first**, then falls back to the Claude Desktop paths, and reports which location satisfied the check. (Builds before 0.4.0 looked only at the Desktop paths and wrongly advised running `tages init` on a correct setup — if you see that advice, you are on a stale CLI.)

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
