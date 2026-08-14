# Team Onboarding

This is the end-to-end path for an engineer **joining a project that already exists** — someone on your team already created it and has invited you.

- Creating a project for the first time instead? Use [Quickstart](quickstart.md).
- Doing local development *on the Tages repo itself*? See [collaborator onboarding](collaborator-onboarding.md).

Read step 2 before you start. It is the one step people get wrong, and getting it wrong produces a setup that looks successful and is useless.

---

## Before you start

You need:

- **Node.js**, **pnpm**, and `git`. The repo pins `pnpm@10.33.0` via `packageManager`; this sequence was verified on Node 24.11.1 with pnpm 10.33.0. There is no `engines` field, so older Node versions are untested rather than known-bad.
- **A project ID** (a UUID) from the project owner.
- **An invite, with the `admin` role.** A plain `member` can read but cannot write — see [Roles](#roles-you-need-admin-not-member). Ask the owner to confirm they invited you as `admin` from the dashboard.

> **Do not install from npm.** The published `@tages/cli` is **0.2.1** (April) and has no `--project-id` flag at all; `@tages/server` on npm is **0.1.1**. `npm install -g @tages/cli` will not get you a working team setup. Build from source, as below.

---

## 1. Build the CLI from source

Clone Tages somewhere you keep source checkouts. **This clone is a build artifact, not your workspace** — you will never work inside it.

```bash
git clone https://github.com/ryantlee25-droid/tages.git ~/src/tages
cd ~/src/tages
git checkout release/2026-08-13-onboarding
pnpm install --frozen-lockfile
pnpm -r build
```

> **The `git checkout` line is required until this branch merges to `main`.** The join path
> (`tages link --project-id`) does not work on `main` — on that build it crashes with
> `ReferenceError: exports is not defined in ES module scope`. Once the branch is merged,
> drop the checkout line and clone `main` as usual.

Then link the CLI globally. Run this from `packages/cli`, **not** from the repo root — the root package is private and exposes no `tages` binary:

```bash
cd ~/src/tages/packages/cli
pnpm link --global
```

Verify:

```bash
tages --version
# 0.3.0
```

If you get anything other than `0.3.0`, you are running a stale npm copy. Remove it (`npm uninstall -g @tages/cli`) and re-link.

**Already linked `tages` before? Re-link it.** The CLI now builds to a single bundled `dist/index.js`; it used to build to `dist/packages/cli/src/index.js`. An existing global link still points at the old path, so after you pull and rebuild, `tages` fails with `command not found` or `No such file or directory`. Re-running the link above from `packages/cli` fixes it:

```bash
cd ~/src/tages/packages/cli
pnpm link --global
```

Leave the built clone in place. Your agent will be wired to the server binary inside it (`~/src/tages/packages/server/dist/index.js`), so deleting or un-building the clone breaks every project you set up.

---

## 2. Change into your own repo first

**`tages link` writes `.mcp.json` into the current directory.** That file is what gives your agent memory, and it only applies to the directory it sits in.

```bash
cd ~/work/my-actual-project    # <- the repo you write code in
```

If you run step 3 while still inside `~/src/tages`, the command will report success and you will have wired Tages memory to *the Tages source clone* — a directory you never work in. Your own repo gets nothing. Nothing warns you.

Rule of thumb: **run `tages link` once per repo you want memory in, from inside that repo.**

---

## 3. Join the project

```bash
tages link --project-id <uuid>
```

This is designed to be a teammate's genuine first command. In one pass it:

1. Runs GitHub OAuth in your browser if you have no saved session (skipped if you already authenticated), saving credentials to `~/.config/tages/auth.json` (mode `0600`).
2. Verifies you are actually a member of that project (fail-closed — a non-member is rejected, not silently downgraded).
3. Writes `~/.config/tages/projects/<slug>.json` and a `.tages/config.json` marker in the current directory.
4. Writes **`.mcp.json` in the current directory**, pointing at your locally built server, and adds `.mcp.json` to this repo's `.git/info/exclude` (it carries your project ID and Supabase key, so it must stay out of git).
5. Installs a `post-commit` git hook for auto-indexing.

Optional: register the project under a different local name with `--slug <alias>` (useful if your directory name differs from the project's slug, or the slug is already taken locally).

**Where the owner finds the UUID:** `tages status` shows it on the `ID:` line; the dashboard shows it under **Project ID** at `https://app.tages.ai/app/projects/<slug>/settings`, alongside a copy-ready `tages link --project-id ...` command.

### Confirm which server you were wired to

`link` prints one of these. You want the first:

```
MCP server: node /Users/you/src/tages/packages/server/dist/index.js (local build)
MCP server: npx -y @tages/server (published package)
```

If you got the `npx` line, the local build was not found — re-run `pnpm -r build` in your tages clone, then re-run `tages link --project-id <uuid>`. The published package is **0.1.1** and will not behave like this repo.

---

## 4. Verify

```bash
tages status
```

Expect `Project:` with the team's slug, an `ID:` line carrying your project UUID, `Mode: Cloud`, a `Detected:` line, and a live memory count. Confirm the `ID:` matches the UUID the owner gave you — that is the check that actually proves you joined the right project.

> **Run this from your repo root.** Slug resolution reads `.tages/config.json` in the *current* directory only; it deliberately does not walk up to a parent (`packages/cli/src/config/project.ts:11-23`). From a subdirectory it falls back to the directory name and then, failing that, to *the first project config alphabetically* — so `status`, `remember`, and `recall` can silently report or write to the wrong project. If `Project:` or `ID:` is not what you expect, check `pwd` first.

Check the config landed in the right place — this is the step that catches a step-2 mistake:

```bash
pwd                    # must be your work repo, not the tages clone
cat .mcp.json          # must contain a "tages" entry with your TAGES_PROJECT_ID
```

Read the team's existing knowledge:

```bash
tages onboard
```

Then a read/write smoke test:

```bash
tages remember "onboarding-smoke-test" "Joined the shared project on $(date +%F)" --type entity
tages recall "onboarding smoke test"
```

Watch the output of `remember` carefully:

- `Stored: "..."` (green) — reached the cloud. Good.
- `Stored locally only: ...` + `Cloud sync failed: ...` (yellow) — it is in your local SQLite and **no teammate will ever see it**. The usual cause is that you were invited as `member` rather than `admin`. Note that this still exits `0`, so a script will not catch it.

Finally, **restart Claude Code** in your repo so it picks up the new `.mcp.json`, and approve the project-scoped server if prompted.

> **Ignore `tages doctor`'s MCP verdict.** Its "MCP server config" check only looks at the two *Claude Desktop* config paths and never at the `.mcp.json` that `init`/`link` actually write. It will report `MCP server config — not found` on a perfectly correct setup, and then advise you to "Run `tages init`" — which is the single most destructive thing you can do here (see below). The other `doctor` checks are fine; `cat .mcp.json` is the real test.

---

## Traps

### Never run `tages init` to join an existing project

Use `tages link --project-id`. Full stop. `init` is for *creating* a project.

Project slugs are **globally unique across all owners** (`supabase/migrations/0001_initial_schema.sql:17` — `slug text not null unique`). Running `init` in a directory whose name matches your team's existing project tries to insert a second row with that slug and hits a unique violation. What happens next is genuinely hard to diagnose:

- **On the CLI path**, the unique-violation message contains the word `violates`, which `createCloudProject` matches against its RLS-denial branch (`packages/shared/src/project-factory.ts:51-56`). You are told *"Free tier is limited to 2 projects. Upgrade to Pro for up to 10."* It is not a billing problem. Nothing is wrong with your plan.
- **On the MCP path** it is worse and silent. The server's auto-create falls back to a local-only project (`packages/server/src/config.ts:230-247`), writing `~/.config/tages/projects/<slug>.json` with `projectId: "local-<slug>"`. The only notice goes to stderr, which you will not see. From then on you are quietly writing to a private local store.
- **That config then blocks the fix.** `tages link --project-id` refuses to overwrite a local config pointing at a different project (`packages/cli/src/commands/link.ts:240-245`) and exits 1 with *"already linked locally to a different project (local-...)"*.

**If you are already in this state:** delete `~/.config/tages/projects/<slug>.json`, then re-run `tages link --project-id <uuid>`. Or join under a different local name with `tages link --project-id <uuid> --slug <alias>`.

### Roles: you need `admin`, not `member`

Writes require owner or `admin`. `is_write_authorized` (`supabase/migrations/0031_rbac_write_policies.sql:14-25`) returns true only for the project owner or a `team_members` row with role `owner`/`admin`.

A `member` can read everything and write nothing. Their memories land in local SQLite and never sync — via the CLI you at least get the yellow `Stored locally only` warning, but **through the MCP `remember` tool the agent is told `Stored memory: ...` with no error at all** (`packages/server/src/tools/remember.ts:139-143` ignores the remote-write result). Since your agent uses the MCP path, a `member` will appear to be contributing to team memory for as long as nobody checks.

Both the CLI default (`tages team invite <email>`) and `tages init --team` invite as **`member`**. Owners must invite as admin explicitly:

- Dashboard: pick **admin** in the invite role dropdown (visible to project owners only).
- CLI: `tages team invite <email> --role admin`.
- Fixing an existing member: `tages team role <email> admin` (project owner only).

### Invites must be sent from the dashboard

The dashboard invite route calls `supabase.auth.admin.inviteUserByEmail` and sends a real magic-link email — it is the only email send in the entire codebase.

`tages team invite` **notifies nobody.** It only inserts a `status: 'pending'` row into `team_members` (`packages/cli/src/auth/invite.ts:21-32`), then prints `Invited <email> (pending)`, which reads as though something was sent. If you use it, you must tell the person out-of-band, and the pending row expires after 30 days.

### There is no periodic pull — restart to see a teammate's memory

Sync is **push-only on a timer**. The 60s interval in the MCP server (`packages/server/src/sync/supabase-sync.ts:151-154`) only flushes *your* dirty rows upward. The download half, `hydrate()`, is called from exactly one place: MCP server boot (`packages/server/src/index.ts:178-188`).

So after a teammate writes a memory, **your agent will not see it until you restart your Claude Code session.** There is no `tages pull`, `tages sync`, or `tages fetch` (`tages harness sync` is unrelated — it pushes telemetry, not memories).

Two details worth knowing:

- Hydration is skipped if your cache is under 60s old (`HYDRATION_TTL_MS`, `packages/server/src/index.ts:68`). A restart immediately after another restart pulls nothing — wait a minute and restart again.
- **`tages recall` from the terminal is always live** — it queries Supabase directly and never touches the local cache. So if you want to confirm a teammate's memory exists *right now* without restarting, run `tages recall "<query>"` in a shell. That is the practical workaround.

This is a known limitation, not a broken install.

### Free tier seats

Free is **the owner plus 2 teammates** (`seat_limit_for_project` returns 2 for free, 5 for pro, 25 for team; `supabase/migrations/0046_seat_limits.sql:5-14`). Only `active` members consume a seat — pending invites do not. The fourth person on a free project will fail to join.

---

## Optional: behavioral capture (harness)

Entirely separate from everything above, and safe to skip. Steps 1–4 are what give you shared memory; this adds **opt-in telemetry** about your own agent's tool calls.

Be clear about what this is and is not:

- It captures your Claude Code tool-call events (Read, Edit, Bash, …) with secrets and PII redacted before anything touches disk, writing first to a **local SQLite log**. `tages harness sync` is the only thing that sends data off your machine.
- **It does not give you or anyone else memories.** Events go to the `harness_tool_events` table, which currently has **zero readers** — no dashboard, no MCP tool, no RPC. Nothing converts an event into a recallable memory. It will never show up in `recall` or `onboard`.
- Even `tages drift` does not read it. `drift` reads `field_changes`, `memories`, and `tool_call_log` (`packages/cli/src/commands/drift.ts`). Wiring the harness into drift is Milestone 2, and it is deferred.

The only reason to enable it now is that a future drift baseline needs a data window that cannot be reconstructed after the fact. Nothing you can query today changes because you opted in.

```bash
tages harness enable    # prints what is captured and asks to confirm
tages harness status    # enabled state, last sync, pending event count
tages harness sync      # upload already-redacted pending rows
tages harness disable   # removes only the Tages-owned hooks block
```

`enable` requires a cloud project (steps 1–3 done) and merges a Tages-owned hooks block into your own gitignored `.claude/settings.local.json` — never the shared, committed `.claude/settings.json`, and never anyone else's config.

Two caveats, stated plainly because the consent prompt does not:

- The prompt and `PRIVACY.md` promise a **90-day retention** window. No migration, cron job, or scheduled function currently enforces it — today the rows accumulate indefinitely.
- `sync` is at-least-once with no unique constraint on the table, so a crash between upload and local mark-synced re-uploads the batch as new rows. Duplicates cannot currently be detected or removed.

---

## What to expect from retrieval

Measured on the LongMemEval 50-question calibration set (seed 42, dev project): overall accuracy 72%→80% and recall@k 90%→94% after the two-stage retrieval work. The system is generally good at surfacing the right stored memory for a single, fact-shaped question.

Temporal reasoning ("what did we decide two weeks ago") and single-session-preference questions improved most (38.5%→61.5% and 33%→67%) but started far lower — treat those as improved, not solved.

The known weak spot is the **reader**, not retrieval: how the agent synthesizes several retrieved memories into one answer, especially across sessions. Multi-session synthesis is the weakest category today. If you get a wrong or incomplete answer where several related memories exist, suspect synthesis before assuming recall failed to find them.

Cross-encoder reranking is opt-in (`OPENAI_API_KEY` + `TAGES_OPENAI_EMBED`) and measured net-neutral on the 50q sample, since retrieval already surfaces the gold memory into top-k. Do not expect it to change much day to day.

### Embeddings: nothing to install

Semantic search works out of the box. You do not install Ollama, you do not need an OpenAI key, and there is nothing to configure.

Embeddings are generated by a hosted endpoint that Tages runs (a Supabase edge function using `gte-small`), called with the session you already have from `tages link`. Because every client hits the same endpoint, the whole index is guaranteed to share one vector space — which is not a convention the team has to maintain, it is structural.

This replaced an earlier design where each developer's machine embedded locally. That was worse than it sounds: the old code probed Ollama unconditionally, so a teammate who happened to have Ollama running for an unrelated project silently wrote vectors from a different model into the shared index. Similarity across models is meaningless, so the results looked confident and were noise.

**If the hosted endpoint is unreachable**, `recall` degrades to trigram matching (literal word overlap) rather than failing. You still get results; you lose the ability to match a memory phrased differently from your query. It never silently switches to a different model.

**Overriding the provider is possible and is an all-or-nothing team decision.** `TAGES_EMBED_PROVIDER=ollama` or `=openai` opts a client out of the hosted path. If one person sets it and others do not, you rebuild exactly the mixed-index problem described above. Do not set it unless the whole team does, and changing it later means re-embedding every existing memory.


A 500-question run is pending and will be the headline number; the 50q figures above are a calibration set, not the final word.
