# Team Onboarding

This is the end-to-end path for an engineer joining a project that already has Tages set up — someone on your team has already run `tages init` and has a shared project. If you're the one *creating* that project for the first time, use [Quickstart](quickstart.md) instead. If you're setting up local development on the Tages repo itself (not using Tages as a consumer), see [collaborator onboarding](collaborator-onboarding.md).

Follow the five steps below in order. Each one is copy-pasteable.

## 1. Install

Pick one:

**MCP-only** (fastest — no global install, memories stay local until you also do step 3):

```bash
claude mcp add tages -- npx -y @tages/server
```

**Full CLI** (needed for steps 2–5 below — `link`, `status`, `onboard`, `harness`, etc. are CLI commands, not MCP tools):

```bash
npm install -g @tages/cli
```

Most people installing to join an existing team project want the full CLI, since joining a shared project requires `tages init` + `tages link`.

## 2. Authenticate

```bash
tages init
```

This opens a browser for GitHub OAuth, saves your credentials to `~/.config/tages/auth.json` (mode `0600`), and — by default — creates a **new** cloud project named after your current directory. That's fine; you'll bind to the team's existing project in step 3 regardless of what `init` creates here.

If you're on a headless machine or CI runner with no browser available, skip the OAuth prompt entirely: set the `TAGES_SERVICE_KEY` environment variable to a service-role key (bypasses RLS, used for CI/headless per `createAuthenticatedClient`'s auth precedence), or generate a scoped API token with `tages token generate --name "<label>"` and export it as `TAGES_API_TOKEN` — see [GitHub Actions setup](github-actions.md) for the full CI-token pattern.

## 3. Join the shared team project

Once authenticated, bind this machine to the project your team already shares:

```bash
tages link --project-id <uuid>
```

Ask the project owner for `<uuid>` — they get it from `tages status` (it's the project the owner is currently bound to) or from the project page in the dashboard.

Optionally register a local alias so you can refer to the project by name instead of UUID on this machine:

```bash
tages link --slug <alias>
```

> **Legacy form**: `tages link <slug>` (no flags) only works on the machine that originally created the project — it looks up a local project config file by slug, which only exists where `tages init` ran for that slug. Use `--project-id` to bind a *different* machine to an *existing* project; that's the team-join path.

## 4. Verify

Confirm the bind worked and you can see the project's knowledge:

```bash
tages status
```

Expect `Project:`, `Mode: Cloud`, `Detected:` (should say `marker (.tages/config.json)` if step 3 wrote the link), and a live memory count.

```bash
tages onboard
```

This prints the project briefing — architecture, conventions, decisions, lessons, entities, and patterns your team has stored, grouped by type.

Then do a quick read/write smoke test:

```bash
tages remember "onboarding-smoke-test" "Joined the shared project on $(date +%F)" --type entity
tages recall "onboarding smoke test"
```

If `recall` returns what you just stored, you're fully wired up.

## 5. Enable behavioral capture (optional)

This is a separate opt-in from steps 1–4 above — everything above just gets you reading/writing shared memory. This step turns on the instrumented harness, which captures your own Claude Code tool-call activity (Read, Edit, Bash, etc., with secrets/PII redacted before anything touches disk) so the team can eventually measure agent behavioral drift.

**Status right now: Milestone 1 — capture only.** `tages drift` does not yet read these events; that's Milestone 2, deferred. Nothing computed today changes because you opt in. The reason to opt in *now* rather than later is that Milestone 2's drift baseline needs a data window — every day you're not capturing is a day of baseline that can't be reconstructed after the fact.

```bash
tages harness enable
```

This requires a cloud project (steps 2–3 above must already be done). It prints exactly what's captured, what's redacted, where the config is written, and the 90-day retention window, then asks for confirmation before writing anything. It merges a Tages-owned hooks block into your own gitignored `.claude/settings.local.json` — never the shared, committed `.claude/settings.json`, and never anyone else's config but yours.

```bash
tages harness status
```

Shows whether it's enabled and how many captured events are pending (not yet uploaded).

```bash
tages harness sync
```

Uploads the already-redacted pending rows to your project. Nothing is uploaded automatically — capture always writes to a local SQLite log first; `sync` is the only thing that leaves your machine, and it only sends what enable's confirmation prompt already told you would be captured.

To turn it off at any point: `tages harness disable` (removes only the Tages-owned hooks block; any other hooks you have configured are left untouched).

## What to expect

Retrieval quality is solid where it's been measured: on the LongMemEval 50-question calibration set (seed 42, dev project), overall accuracy is 72%→80% and recall@k is 90%→94% after the two-stage retrieval work, meaning the system is generally good at surfacing the right stored memory into its candidate set for a single, fact-shaped question. Temporal reasoning ("what did we decide two weeks ago") and single-session-preference questions saw the largest jumps (38.5%→61.5% and 33%→67% respectively) but started from a much lower base, so treat those categories as improved-but-still-the-weaker end, not solved. The known weak spot is the *reader* — how the agent synthesizes multiple retrieved memories into an answer, especially across sessions — rather than retrieval itself; multi-session synthesis is the weakest category today, so if an agent gives you a wrong or incomplete answer when several related memories exist, suspect synthesis before assuming recall failed to find the memory at all. Cross-encoder reranking is available but opt-in (requires `OPENAI_API_KEY` + `TAGES_OPENAI_EMBED`) and measured net-neutral on the 50q sample, since retrieval already surfaces the gold memory into the top-k without it — don't expect turning it on to change much day to day. A 500-question run is pending and will be the headline accuracy number going forward; the 50q figures above are the calibration set, not the final word.
