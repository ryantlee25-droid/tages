# Plan: Group 3 — Competitive Differentiators
_Created: 2026-04-06 | Type: New Feature (security/trust posture)_
_Branch: `dev-5` (off `main`)_

## Goal

Ship seven competitive differentiator features that make Tages credible to enterprise buyers: a public security page, SSO/SAML support, an SBOM, automated dependency security updates, pre-commit secret scanning, a SOC 2 self-assessment document, and a pen test readiness document.

## Background

Groups 1–2 (13 security hardening tasks) are complete. Group 3 completes the security roadmap with features that are primarily visible to enterprise evaluators, security teams, and compliance buyers. Most tasks are independent and can be executed in parallel. The one exception is G3-T14 (SSO/SAML), which requires a DB migration and has significant implementation surface — it is split into three sequential sub-tasks.

## Scope

**In scope:**
- `/security` marketing page in the existing `(marketing)` route group
- SAML 2.0 SSO via Supabase SAML Management API, gated to Pro tier
- CycloneDX SBOM generated on tag push via GitHub Actions
- Dependabot config for security-update-aware automated PRs
- Gitleaks pre-commit hook with graceful degradation
- SOC 2 Trust Service Criteria self-assessment document
- Pen test readiness document (attack surface + threat model)

**Out of scope:**
- Full third-party SOC 2 audit engagement
- Custom SAML identity provider implementation (Supabase handles IdP communication)
- Automated pen testing tooling
- Changes to existing pricing tiers (Free/Pro/Self-hosted remain as-is)

## Technical Approach

**Route conventions**: New marketing pages go in `apps/dashboard/src/app/(marketing)/`. The layout is a passthrough (`<>{children}</>`). Follow the pattern of the homepage: dark background `#0a0a0a`, accent color `#3BA3C7`, `text-zinc-400` body copy, Tailwind + shadcn/ui.

**Pro tier gate**: `is_pro(auth.uid())` is a SQL function defined in migration 0031. For server-side API route gating, read `user_profiles.is_pro` via the admin Supabase client (pattern: `apps/dashboard/src/app/api/stripe/webhook/route.ts`).

**Migrations**: Next migration number is `0035`. Sequential numbering is required per project convention. Migration 0034 is the last one (`0034_pricing_restructure.sql`).

**Pre-commit hooks**: Husky is installed (`"prepare": "husky"` in root `package.json`). The existing hook at `.husky/pre-commit` runs `pnpm typecheck`. Append the Gitleaks check after this line — do not replace it. Gitleaks must degrade gracefully: if binary not found, warn and `exit 0`.

**GitHub Actions**: Existing workflow is `.github/workflows/ci.yml` (PR + main push). The SBOM workflow is a new separate file triggered only on `tags: ['v*']`.

**Documents**: SOC 2 self-assessment and pen test readiness are Markdown files. Target: `docs/` directory (alongside `self-hosting.md`, `quickstart.md`, etc.).

Note: `apps/dashboard/src/lib/env.ts` is shared infrastructure — adding SSO env vars here affects startup validation for the entire dashboard. Add new SSO vars to `OPTIONAL_VARS` (not `REQUIRED_VARS`) so the app starts without SSO configured.

---

## Tasks

### Wave 1 — Fully Independent (can run in parallel)

- [ ] **G3-T13: Public /security page** — Static marketing page at `/security` covering encryption model, data flow, auth model, zero-training guarantee, and self-hosting option.
  - Effort: M (half to full day)
  - Files:
    - CREATE `apps/dashboard/src/app/(marketing)/security/page.tsx`
    - CREATE `apps/dashboard/src/components/marketing/security-page.tsx` (content component; keep page.tsx thin)
    - MODIFY `apps/dashboard/src/app/sitemap.ts` (add `/security` to static routes)
  - Implementation: No auth check — this is a public page. Sections: (1) Encryption at rest — AES-256-GCM field-level, opt-in via `TAGES_ENCRYPTION_KEY`; (2) Encryption in transit — TLS 1.2+; (3) Authentication — Supabase Auth + GitHub OAuth + SHA-256 hashed CLI tokens, token expiry, auth audit log; (4) Data flow — no LLM training, memories stay in user's own Supabase project; (5) Self-hosting — link to `docs/self-hosting.md`; (6) Responsible disclosure — link to `SECURITY.md`. Add page to `sitemap.ts`.
  - Tests: Verify `/security` is included in the sitemap output. Smoke test: page renders without auth. No unit tests required for pure static content.
  - Depends on: nothing

- [ ] **G3-T15: SBOM generation** — CycloneDX SBOM generated automatically on every version tag push, uploaded as a GitHub release asset.
  - Effort: S (2–3 hours)
  - Files:
    - CREATE `.github/workflows/sbom.yml`
  - Implementation: Trigger `on: push: tags: ['v*']`. Use `anchore/sbom-action@v0` to generate CycloneDX JSON SBOM for the full monorepo. Upload as release asset via `softprops/action-gh-release@v2`. Permissions required: `contents: write` (release upload). Include workflow comments explaining what the SBOM covers and where to find it on the release page.
  - Tests: No automated test. Validate by pushing a test tag to a fork branch and confirming the release asset appears. Document this manual verification step in the workflow file header comments.
  - Depends on: nothing

- [ ] **G3-T16: Dependabot config** — Dependabot configuration covering npm and GitHub Actions ecosystems.
  - Effort: S (1–2 hours)
  - Files:
    - CREATE `.github/dependabot.yml`
  - Implementation: Two `package-ecosystem` entries: `npm` (directory: `/`) and `github-actions` (directory: `/`). Schedule: weekly. `open-pull-requests-limit: 5`. Add labels `["dependencies", "security"]`. Add `ignore` rules to suppress non-security minor/patch bumps for known-stable deps (e.g., `@modelcontextprotocol/sdk`, shadcn/ui components) using `update-types: ["version-update:semver-minor", "version-update:semver-patch"]`.
  - Warning: Dependabot has no native "security-only" mode for npm — it opens PRs for all updates unless `ignore` rules are applied. Configuring auto-merge for CVE-only PRs is a follow-up (out of scope here).
  - Tests: Verify the file is valid YAML. Push to `dev-5` — Dependabot parses the config within 24 hours (visible in repo Insights > Dependency graph).
  - Depends on: nothing

- [ ] **G3-T17: Pre-commit secret scanning** — Gitleaks hook scanning staged files before every commit, with graceful degradation when the binary is absent.
  - Effort: M (half day)
  - Files:
    - MODIFY `.husky/pre-commit` (append Gitleaks check after existing `pnpm typecheck` line)
    - CREATE `.gitleaks.toml` (repo root)
  - Implementation: In `.husky/pre-commit`, add a block: check `command -v gitleaks`; if not found, print a yellow warning (`echo "\033[33m[warn] gitleaks not found — skipping secret scan. Install: https://github.com/gitleaks/gitleaks\033[0m"`) and `exit 0`; if found, run `gitleaks protect --staged --config .gitleaks.toml`. In `.gitleaks.toml`, configure `[allowlist]` to exclude test fixture files (`**/*test*`, `**/*spec*`, `**/*.example*`) and known-safe patterns (example env values in `docs/`).
  - Tests: Create a test commit with a fake AWS key pattern (`AKIA[0-9A-Z]{16}`) in a staged file — confirm hook blocks commit. Remove `gitleaks` from PATH temporarily — confirm hook exits 0 with warning. Run `pnpm test` to confirm no regressions.
  - Depends on: nothing
  - Notes: Do not add `gitleaks` as a devDependency — it is a native binary. Append install instructions to `README.md` under a "Contributing" or "Development setup" section.

- [ ] **G3-T18: SOC 2 self-assessment** — Trust Service Criteria self-assessment document for enterprise sales conversations.
  - Effort: L (1–2 days, calibrated 1.5x for documentation depth uncertainty)
  - Files:
    - CREATE `docs/SOC2-SELF-ASSESSMENT.md`
  - Content structure: Header disclaimer ("self-assessment, not a third-party audit"). Then for each Trust Service Criterion: Security (CC6–CC9), Availability (A1), Processing Integrity (PI1), Confidentiality (C1), Privacy (P1–P8) — document: control objective, current implementation (reference actual files/migrations where applicable — e.g., RLS in migrations 0031+, HSTS and CSP in dashboard middleware, Zod input validation on all 30 MCP tools, SHA-256 token hashing, auth audit log in migration 0033, AES-256-GCM encryption), known gaps and limitations, remediation roadmap.
  - Tests: No automated test. Cross-check control claims against the actual codebase before finalizing (verify RLS policies, middleware headers, etc. are as described).
  - Depends on: nothing (but benefits from G3-T19 being written first — the threat model informs the gap analysis)
  - Pre-mortem: If this takes 3x longer, it will be because exhaustively enumerating controls requires reading every migration and server module. Mitigate by targeting 2–4 sentences per control, not exhaustive prose.

- [ ] **G3-T19: Pen test readiness document** — Attack surface inventory, threat model, and scope definition for use by an external pen tester.
  - Effort: M (half to full day)
  - Files:
    - CREATE `docs/PEN-TEST-READINESS.md`
  - Content sections: (1) System overview with ASCII architecture diagram, (2) Attack surface inventory — web app API endpoints (`/api/projects/*`, `/api/stripe/*`, `/api/sso/*`), Supabase direct database access, CLI token auth flow, MCP stdio transport, npm package supply chain, (3) STRIDE threat model table for each surface, (4) In-scope / out-of-scope assets (consistent with `SECURITY.md`), (5) Testing constraints (no production data, no DoS, coordinate via `security@tages.dev`), (6) Test account provisioning instructions.
  - Tests: No automated test. Review for consistency with `SECURITY.md` scope section before merging.
  - Depends on: nothing

---

### Wave 2 — Sequential Sub-tasks (G3-T14 SSO/SAML)

- [ ] **G3-T14a: SSO DB migration** — Create `sso_configs` table with RLS.
  - Effort: S (2–3 hours)
  - Files:
    - CREATE `supabase/migrations/0035_sso_configs.sql`
  - Schema:
    ```sql
    create table sso_configs (
      id            uuid primary key default gen_random_uuid(),
      owner_id      uuid not null references auth.users(id) on delete cascade,
      domain        text not null unique,
      metadata_url  text,
      metadata_xml  text,
      provider_id   text,        -- Supabase SSO provider ID returned after creation
      enabled       boolean not null default false,
      created_at    timestamptz not null default now(),
      updated_at    timestamptz not null default now()
    );
    alter table sso_configs enable row level security;
    create policy "Owner can manage their SSO config"
      on sso_configs for all
      using  (owner_id = auth.uid())
      with check (owner_id = auth.uid());
    ```
  - Tests: Apply migration with `supabase db reset` — confirm no errors. Confirm RLS blocks a second user from reading another user's config row.
  - Depends on: nothing (can start in Wave 1)

- [ ] **G3-T14b: SSO API routes** — Server-side endpoints to manage SSO configs, calling the Supabase SAML Management API.
  - Effort: M (full day)
  - Files:
    - CREATE `apps/dashboard/src/app/api/sso/route.ts` (GET list, POST create)
    - CREATE `apps/dashboard/src/app/api/sso/[id]/route.ts` (GET single, PATCH update, DELETE)
    - MODIFY `apps/dashboard/src/lib/env.ts` — add `SUPABASE_PROJECT_REF` and `SUPABASE_MANAGEMENT_API_KEY` to `OPTIONAL_VARS` with hint text `"SSO features will be unavailable."`
  - Implementation: Use admin Supabase client (same `SUPABASE_SERVICE_ROLE_KEY` pattern as the Stripe webhook). Before any mutation, check `user_profiles.is_pro` for the authenticated user — return `{ error: "SSO requires Pro tier" }` with status 403 if not Pro. On POST, call the Supabase Management API (`https://api.supabase.com/v1/projects/{ref}/sso/providers`) to register the SAML provider using `metadata_url` or `metadata_xml`. Store the returned `provider_id` back to `sso_configs`. On DELETE, call the Management API to remove the provider, then delete the row.
  - Tests: Unit test — mock `user_profiles` returning `is_pro: false`, expect 403. Unit test — mock `SUPABASE_MANAGEMENT_API_KEY` as unset, expect a clear error response (not a crash). Unit test — mock Management API success, confirm `provider_id` is stored.
  - Depends on: G3-T14a
  - Pre-mortem: If this task fails or takes 3x longer, it will be because Supabase SAML Management API behavior diverges from docs (key type, payload format, error shapes). Mitigate: spike against a dev Supabase project before implementing the full route handlers.

- [ ] **G3-T14c: SSO dashboard UI** — SSO configuration panel in the app settings, visible only to Pro users.
  - Effort: M (full day)
  - Files:
    - CREATE `apps/dashboard/src/app/app/settings/sso/page.tsx`
    - CREATE `apps/dashboard/src/components/sso-config-panel.tsx`
    - CREATE or MODIFY `apps/dashboard/src/app/app/settings/layout.tsx` (add SSO link to settings nav; create layout if it does not exist)
  - Implementation: Server component — read `user_profiles.is_pro`. If not Pro, render a locked state with a link to `/app/upgrade` (follow the upgrade page pattern). If Pro, render the `SsoConfigPanel` client component. Panel shows: domain input, metadata URL input or XML paste area, enable/disable toggle, current status display (provider ID if registered). On submit, POST to `/api/sso`. Use existing shadcn/ui primitives: `Input`, `Button`, `Label`, `Textarea`, `Switch`.
  - Tests: Render test — non-Pro user sees upgrade prompt (mock `is_pro: false`). Render test — Pro user sees the config form (mock `is_pro: true`). Interaction test — form submit calls POST `/api/sso` with correct payload.
  - Depends on: G3-T14b

---

## File Ownership Matrix

| Task | Creates | Modifies |
|------|---------|----------|
| G3-T13 | `app/(marketing)/security/page.tsx`, `components/marketing/security-page.tsx` | `app/sitemap.ts` |
| G3-T14a | `supabase/migrations/0035_sso_configs.sql` | — |
| G3-T14b | `app/api/sso/route.ts`, `app/api/sso/[id]/route.ts` | `lib/env.ts` |
| G3-T14c | `app/app/settings/sso/page.tsx`, `components/sso-config-panel.tsx`, `app/app/settings/layout.tsx` | — |
| G3-T15 | `.github/workflows/sbom.yml` | — |
| G3-T16 | `.github/dependabot.yml` | — |
| G3-T17 | `.gitleaks.toml` | `.husky/pre-commit` |
| G3-T18 | `docs/SOC2-SELF-ASSESSMENT.md` | — |
| G3-T19 | `docs/PEN-TEST-READINESS.md` | — |

No file conflicts. `lib/env.ts` is touched only by G3-T14b. `.husky/pre-commit` is touched only by G3-T17.

---

## Open Questions

- [ ] **Supabase SAML Management API credential type** — The Supabase Management API requires a personal access token (not a service role key). Confirm the exact header format and token scope required. Blocks: G3-T14b. Default if unresolved: use a personal access token stored as `SUPABASE_MANAGEMENT_API_KEY`; document it as a required env var to enable SSO. Who: G3-T14b implementer should verify against Supabase docs before writing the route.

- [ ] **Settings nav location** — Whether a `settings/layout.tsx` already exists was not confirmed. Blocks: G3-T14c. Default if unresolved: create `apps/dashboard/src/app/app/settings/layout.tsx` with a sidebar nav that includes the SSO link, rather than modifying an unknown component.

- [ ] **Gitleaks in CI** — Should the Gitleaks hook be installed in `ci.yml` so it runs on every PR? Blocks: nothing (hook degrades gracefully without the binary). Default if unresolved: skip CI installation; treat `gitleaks` as a local dev prerequisite only, with install instructions added to `README.md`.

---

## Parallelizability Summary

Wave 1 (G3-T13, T15, T16, T17, T18, T19) are fully independent — six tasks with zero dependencies between them. Wave 2 (G3-T14a → T14b → T14c) is sequential within itself. G3-T14a can begin alongside Wave 1 tasks on day 1.

If running as a Spectrum, suggested Howler grouping (6 Howlers):
- **Howler A**: G3-T13 (security page)
- **Howler B**: G3-T14a + T14b + T14c (SSO, sequential)
- **Howler C**: G3-T15 + G3-T16 (both S-sized CI/config tasks, no overlap)
- **Howler D**: G3-T17 (pre-commit scanning)
- **Howler E**: G3-T18 (SOC 2 self-assessment)
- **Howler F**: G3-T19 (pen test readiness)

---

## Definition of Done

- [ ] All 7 tasks (9 sub-tasks including T14 split) implemented and self-reviewed
- [ ] `/security` page renders at `/security` without authentication
- [ ] `/security` appears in `sitemap.ts` output
- [ ] SSO config API returns 403 for non-Pro users (verified by test)
- [ ] SBOM workflow file present; runs without error on a test tag push
- [ ] `.github/dependabot.yml` present and valid YAML
- [ ] Gitleaks hook blocks a commit containing a fake AWS key; degrades gracefully (exit 0 + warning) when binary is absent
- [ ] `docs/SOC2-SELF-ASSESSMENT.md` covers all five Trust Service Criteria
- [ ] `docs/PEN-TEST-READINESS.md` covers all six required sections
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] PR opened against `main` from `dev-5`
- [ ] `README.md` updated with a `## Release Notes` entry for Group 3

---

---

# Plan: End-of-Session Workflow
_Created: 2026-04-06 | Type: New Feature_

## Goal

Give users a smooth, low-friction path to persist codebase learnings from a coding session into Tages cloud — either automatically via a Claude Code hook, or manually via an enhanced CLI command.

## Background

The MCP server already has a `session_end` tool that parses a free-text summary and auto-extracts memories by keyword. The `observe` tool captures incremental observations mid-session. What is missing is: (1) a user-facing CLI command that surfaces these capabilities outside the MCP context, and (2) a Claude Code hook that fires `session_end` automatically so nothing is lost when a session closes without a user explicitly doing so.

The key insight is that "codebase learnings" (conventions, decisions, architecture, lessons) are Tages's concern; "user preferences and workflow feedback" stay in `~/.claude/memory`. The workflow must reinforce that boundary so users don't conflate the two.

## Scope

**In scope:**
- New `tages session-wrap` CLI command: interactive end-of-session summary flow
- Claude Code hook integration: a `--hook` flag on `tages init` that writes the Claude Code `PostToolUse` or session-end hook config
- Documentation update: add a "Hooks / End-of-session" section to `docs/claude-code-setup.md`
- Enhancement to `session_end` MCP tool: accept an optional `projectSlug` argument to make project resolution explicit when hook is non-interactive

**Out of scope:**
- Changes to the `observe` tool (already works well for mid-session capture)
- Cursor, Windsurf, or other agent hook integrations (follow-on)
- Automatic LLM-generated summaries of session transcripts (deferred — dependency on transcript access API)
- Any new Supabase migrations

## Technical Approach

**`tages session-wrap`** is a CLI command that: (1) prompts the user with a multi-line input for a session summary, (2) calls the same extraction logic already in `handleSessionEnd` via `packages/server/src/tools/session-end.ts`, and (3) prints extracted memories to stdout. It reuses `rememberCommand`'s project config loading pattern (`loadProjectConfig` from `remember.ts`) and the same Supabase upsert path. It does NOT shell out to the MCP server — it imports the shared extraction logic directly or duplicates the keyword-matching inline (the logic is small, ~50 lines).

**Claude Code hook** writes a `hooks` block into `claude_desktop_config.json` alongside the existing `mcpServers.tages` entry. Claude Code supports `PostToolUse` hooks (shell commands run after specific tool calls) and a `Stop` hook (shell command run when a session ends). The `Stop` hook is the right trigger: `tages session-wrap --non-interactive`. In non-interactive mode, the command reads a pre-written session notes file at a well-known path (`~/.config/tages/pending-session-notes.txt`) if it exists, processes it, then deletes the file. If the file does not exist, the hook exits silently (exit 0) — no noise.

Note: `packages/cli/src/config/mcp-inject.ts` is shared infrastructure — it already reads/writes `claude_desktop_config.json`. The new hook injection must go through this file or alongside it. Changes here affect the `tages init` flow. Treat this as a modification risk.

Note: `packages/server/src/tools/session-end.ts` is shared between the MCP server and (via import) potentially the CLI. If any logic is extracted to `packages/shared/`, verify `packages/shared/src/types.ts` is not changed — it is imported by all three packages.

**Memory type guidance** is the UX differentiator. The `session-wrap` prompt should show a brief reminder: "Codebase conventions, decisions, and gotchas only — not personal preferences." This keeps the session-wrap workflow scoped and teaches the mental model.

---

## Tasks

- [ ] **T1: Extract `sessionEndExtract` to a shared utility** — Move the keyword-based memory extraction logic out of `packages/server/src/tools/session-end.ts` into a new file `packages/server/src/tools/session-extract.ts` that exports a single `extractMemoriesFromSummary(summary: string): Array<{ key: string; value: string; type: MemoryType }>` function. Update `session-end.ts` to import from it.
  - Files:
    - CREATE `packages/server/src/tools/session-extract.ts`
    - MODIFY `packages/server/src/tools/session-end.ts` (import + use `extractMemoriesFromSummary`)
  - Tests: Existing `session-end` tests should continue to pass unchanged. Add 3–4 unit tests directly on `extractMemoriesFromSummary` — confirm "decided to use Zod" → `decision`, "always snake_case routes" → `convention`, "gotcha with PromiseLike" → `lesson`, sentence with no matching keyword → empty array.
  - Depends on: nothing
  - Notes: Keep the function in `packages/server/` (not `packages/shared/`) — the CLI will import the server package or duplicate the logic inline (T2 decides). Do not move types to `packages/shared/src/types.ts` — that file is shared infrastructure used by all three packages.

- [ ] **T2: Add `tages session-wrap` CLI command** — New command that prompts for a freeform session summary, runs extraction, persists extracted memories to Supabase + local SQLite, and prints a summary of what was stored.
  - Files:
    - CREATE `packages/cli/src/commands/session-wrap.ts`
    - MODIFY `packages/cli/src/index.ts` (register the new command)
  - Implementation: The command has two modes: (a) interactive (default) — use `readline` or a simple `process.stdin` read to collect a multi-line summary (end on double-newline or Ctrl+D), then run extraction + persist via the same Supabase upsert pattern as `rememberCommand`; (b) `--non-interactive` — read `~/.config/tages/pending-session-notes.txt` if it exists, process silently, delete the file, exit 0. Project config loading: copy `loadProjectConfig` from `remember.ts` (same pattern). Memory persistence: copy the Supabase upsert block from `remember.ts` — do not call `rememberCommand` as a subprocess. Extraction logic: inline the keyword-matching from T1's exported function (or import it if the build supports cross-package imports). Print a typed summary at the end: `Stored 3 memories: [decision] ..., [convention] ..., [lesson] ...`. If no memories are extractable, print: `No codebase learnings extracted. Use \`tages remember\` for specific items.`
  - Tests: Unit test — non-interactive mode with a temp file containing "decided to use Zod for validation" → expect 1 memory stored, file deleted. Unit test — non-interactive mode with no pending file → expect silent exit (no error thrown). Unit test — summary with no keyword matches → expect the "no learnings extracted" message and zero Supabase calls.
  - Depends on: T1
  - Pre-mortem: If this task takes 3x longer, it will be because the multi-line interactive readline input is awkward to test or behaves differently on Windows. Mitigate: keep interactive input simple (single `readline.createInterface` read, terminated by an empty line) and add a `--summary <text>` flag for scripted / test use.

- [ ] **T3: Hook injection in `tages init`** — Add a `--hooks` flag (default: `true` in Claude Code environments, `false` otherwise) to `tages init` that writes a `Stop` hook entry into `claude_desktop_config.json` alongside the MCP server entry.
  - Files:
    - MODIFY `packages/cli/src/config/mcp-inject.ts` (add hook injection alongside `mcpServers.tages`)
    - MODIFY `packages/cli/src/commands/init.ts` (pass `installHooks` flag to `injectMcpConfig`)
    - MODIFY `packages/cli/src/index.ts` (add `--no-hooks` option to `init` command)
  - Implementation: The `Stop` hook entry in `claude_desktop_config.json` has the shape:
    ```json
    "hooks": {
      "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "tages session-wrap --non-interactive" }] }]
    }
    ```
    In `mcp-inject.ts`, only write the hook if it does not already exist (idempotent). Do not overwrite an existing `hooks.Stop` array — append to it. Add a `installHooks?: boolean` param to `injectMcpConfig`. In `init.ts`, pass `installHooks: !options.noHooks`. After injecting, print: `  Hook installed: session learnings will auto-persist on session end`.
  - Tests: Unit test — calling `injectMcpConfig` with `installHooks: true` on an empty config produces a valid `hooks.Stop` entry. Unit test — calling it a second time does not duplicate the hook entry. Unit test — calling it with `installHooks: false` writes no `hooks` key.
  - Depends on: T2 (the hook command must exist before advertising it)
  - Pre-mortem: If this task fails or takes 3x longer, it will be because the Claude Code hooks config schema has changed from what the docs describe — the JSON shape for `Stop` hooks may differ. Mitigate: verify the current schema against a live `claude_desktop_config.json` before writing the injection logic; if uncertain, use the `--hooks` flag as opt-in only and document the manual JSON snippet in the docs.
  - Notes: `mcp-inject.ts` already reads and writes `claude_desktop_config.json`. Any change here is load-bearing for `tages init` — test the full init flow after modifying it.

- [ ] **T4: Document the end-of-session workflow** — Update `docs/claude-code-setup.md` with a new section covering the hook, `session-wrap`, and the codebase-vs-personal-memory boundary.
  - Files:
    - MODIFY `docs/claude-code-setup.md`
  - Content to add: A new section "## End-of-session workflow" after the existing "## How it works" section. Include: (1) how the `Stop` hook works and where it's installed, (2) the `pending-session-notes.txt` convention for pre-populating a summary before session end, (3) how to run `tages session-wrap` manually, (4) a clear callout box explaining what belongs in Tages vs. `~/.claude/memory`: "Tages stores codebase knowledge (conventions, decisions, architecture, lessons). Personal workflow preferences and Claude Code behavior settings belong in your local Claude Code memory files."
  - Tests: No automated test. Verify all CLI flags and file paths mentioned in the docs match the implementation.
  - Depends on: T2, T3

---

## File Ownership Matrix

| Task | Creates | Modifies |
|------|---------|----------|
| T1 | `packages/server/src/tools/session-extract.ts` | `packages/server/src/tools/session-end.ts` |
| T2 | `packages/cli/src/commands/session-wrap.ts` | `packages/cli/src/index.ts` |
| T3 | — | `packages/cli/src/config/mcp-inject.ts`, `packages/cli/src/commands/init.ts`, `packages/cli/src/index.ts` |
| T4 | — | `docs/claude-code-setup.md` |

File conflict: `packages/cli/src/index.ts` appears in T2 and T3.
Resolution: Make T3 depend on T2 (already stated). T2 registers the command; T3 adds the `--no-hooks` option to `init`. The implementer handles both changes in T2 first, then T3 touches `index.ts` only for the `--no-hooks` addition. Alternatively, combine both `index.ts` changes into T3 if doing them sequentially in one session.

---

## Open Questions

- [ ] **Claude Code `Stop` hook schema** — The exact JSON shape for the `Stop` hook in `claude_desktop_config.json` needs verification against a live installation. Blocks: T3. Default if unresolved: implement T3 as opt-in only with a printed JSON snippet the user can paste manually, and document it in T4. Who: T3 implementer should check `~/Library/Application Support/Claude/claude_desktop_config.json` on a machine where hooks are already configured.

- [ ] **`session-extract.ts` cross-package import** — Can `packages/cli/` import from `packages/server/` in this monorepo's tsconfig setup? (Current CLI imports use `@tages/shared` but not `@tages/server`.) Blocks: T2. Default if unresolved: inline the 50-line keyword-matching logic directly in `session-wrap.ts` rather than importing from the server package. This avoids a new cross-package dependency at the cost of minor duplication. Who: T2 implementer checks `packages/cli/tsconfig.json` and `pnpm-workspace.yaml` before deciding.

---

## Definition of Done

- [ ] `tages session-wrap` command runs interactively and extracts memories from a typed summary
- [ ] `tages session-wrap --non-interactive` silently processes `~/.config/tages/pending-session-notes.txt` when present, exits 0 when absent
- [ ] `tages init` writes a `Stop` hook entry into `claude_desktop_config.json` (unless `--no-hooks` is passed)
- [ ] Hook injection is idempotent — running `tages init` twice does not duplicate the hook
- [ ] `docs/claude-code-setup.md` has an "End-of-session workflow" section
- [ ] All new tests pass: `pnpm --filter server test` and `pnpm --filter cli test`
- [ ] `pnpm typecheck` passes
- [ ] PR opened with a note that cross-package import decision (open question 2) was resolved


---

# Plan: End-to-End Product Evaluation
_Created: 2026-04-06 | Type: Bug Fix / UX / Quality_

## Goal

Walk the complete Tages product lifecycle — from fresh install through advanced multi-project use — as a real user would, and document every bug, UX issue, missing feature, and rough edge found.

## Background

All 3 weeks of the implementation plan are complete and 493 tests pass. Today's session fixed 3 bugs and added session-wrap. This evaluation is not a security audit — it is a quality pass from the user's perspective, covering all 13 user journeys in sequence. Each journey builds on the state left by the previous one.

## Scope

**In scope:** All 13 journeys listed below, both cloud and local-only modes, CLI commands, MCP tools, and dashboard pages.
**Out of scope:** Security pen testing, performance benchmarking, load testing, mobile responsiveness beyond basic checks.

## Findings Taxonomy

Each finding should be tagged:
- **BUG** — broken, incorrect behavior, crash, or silent failure
- **UX** — works but is confusing, ugly, or frustrating
- **MISSING** — feature gap — expected behavior that simply isn't there
- **POLISH** — works correctly but rough around the edges

Severity: **P0** (blocks use), **P1** (significant pain), **P2** (friction), **P3** (nice to have)

---

## Tasks

### J1 — Fresh Install
_Effort: S_

Simulate the very first contact a new user has with Tages.

**Steps:**
1. Check the published npm package name: `npm info tages` — confirm it exists, version, and entry point
2. Run `npm install -g tages` from a clean directory. Observe: does the spinner work, are there postinstall errors, does the binary land on PATH?
3. Run `tages --help` — evaluate output clarity, completeness, command grouping. Is session-wrap present? Are subcommands (token, patterns, templates, archive, federation, analytics, enforce) visible or hidden?
4. Run `tages --version` — confirm it matches package.json `version` field (`0.1.0`)
5. Run `tages doctor` with no config — verify it gracefully reports missing auth/project with actionable hints, not a stack trace
6. Run `tages recall "anything"` with no config — verify the error message says "Run \`tages init\` first" not a raw exception
7. Run `tages <unknown-command>` — verify Commander.js shows "unknown command" with the help suggestion, not a crash

**Files to read:** `packages/cli/src/index.ts`, `packages/cli/package.json`

**Known code risks to verify:**
- `tages --help` shows 35+ commands with no grouping. Check whether the output is navigable or overwhelming.
- `tages token`, `tages patterns`, `tages templates`, `tages archive`, `tages federation`, `tages analytics`, `tages enforce` are all subcommand groups — verify they appear in `--help` at all (Commander.js may suppress them depending on how they're registered).

**Tests:** Record output of each command verbatim in your findings.

---

### J2 — Project Initialization
_Effort: M_

Test the `tages init` flow in both modes.

**Steps:**
1. **Local mode:** In a fresh temp directory, run `tages init --local`. Verify:
   - `~/.config/tages/projects/<dirname>.json` created with `supabaseUrl: ""`
   - `~/.config/tages/cache/` directory created
   - MCP config injected at `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) without destroying existing entries
   - Output messages are clear and list actual file paths created
2. **Slug override:** Run `tages init --local --slug my-test-project` — verify the project config file is `my-test-project.json` not `<dirname>.json`
3. **Idempotency:** Run `tages init --local` twice in the same directory — verify the second run updates rather than duplicates the MCP config entry. Open `claude_desktop_config.json` and confirm there is exactly one `tages` entry.
4. **Cloud mode:** Run `tages init` (no `--local`) — verify it opens the browser to `https://tages.dev/auth/cli?redirect_uri=http://127.0.0.1:<port>/callback`. Check that the success HTML page text is "Authenticated!" and the terminal shows "Authenticated with GitHub".
5. **Slug collision:** Init the same slug twice from two different directories — verify the second init finds the existing Supabase project and reuses it rather than creating a duplicate.
6. **No git repo:** Run `tages init --local` in a directory without `.git` — verify it succeeds without crashing (git hook install should silently skip, not error).
7. **Reinspect doctor:** Run `tages doctor` after a successful `tages init --local` — all checks except "Supabase connection" (local mode) and "Git hook" (no .git) should pass.

**Files to read:** `packages/cli/src/commands/init.ts`, `packages/cli/src/config/mcp-inject.ts`, `packages/cli/src/config/paths.ts`

**Known code risks to verify:**
- `injectMcpConfig` in `mcp-inject.ts` writes `npx -y @tages/server` — confirm this resolves correctly when the package is installed globally vs locally.
- `doctor.ts` checks `.git/hooks/post-commit` — the check runs in `cwd`, not the project dir. If you run `tages doctor` from a directory other than the git repo, it will always fail the hook check even if the hook is installed. Document this.
- `init.ts` hardcodes the Supabase anon key in source. Confirm this is intentional (it is a public anon key) and note it for UX documentation.

**Tests:** Read and compare `~/.config/tages/projects/` and the Claude config file before and after each step.

---

### J3 — First Memories (CLI Core Loop)
_Effort: M_

Test the fundamental remember/recall/forget/status workflow.

**Steps:**
1. `tages remember "auth-pattern" "Always use createAuthenticatedClient() for CLI ops, not raw createSupabaseClient()" -t convention` — verify output is `Stored: "auth-pattern" (convention)`, no errors
2. `tages remember "sqlite-cache-path" "Cache stored at ~/.config/tages/cache/<slug>.db" -t architecture --file-paths packages/cli/src/commands/status.ts` — verify file path is accepted
3. `tages remember "no-id-in-upsert" "Never pass id in Supabase upsert for memories — causes FK violation on memory_versions" -t lesson --tags anti-pattern gotcha` — verify multi-tag
4. `tages recall "authentication"` — verify it returns the `auth-pattern` memory. Check output format: type color, key in bold, similarity score shown.
5. `tages recall "cache" --type architecture` — verify type filter works
6. `tages recall --all` — verify all 3 memories returned, ordered by type then key
7. `tages recall --all --type lesson` — verify only the lesson memory returned
8. `tages recall "zzznomatch"` — verify the "No memories found" message, not an error exit
9. `tages recall` (no query, no --all) — verify the error message "Provide a search query, or use --all to list all memories."
10. `tages forget "no-id-in-upsert"` — verify `Deleted: "no-id-in-upsert"` output
11. `tages recall --all` — verify only 2 memories remain
12. `tages status` — verify it shows Project, Mode (Cloud/Local), Cache path and size, memory counts by type

**Files to read:** `packages/cli/src/commands/remember.ts`, `packages/cli/src/commands/recall.ts`, `packages/cli/src/commands/forget.ts`, `packages/cli/src/commands/status.ts`

**Known code risks to verify:**
- `recall.ts` local-mode path uses `LOWER(key) LIKE ?` — this is simple substring match, not trigram. If the user queries "auth" the local result will differ from cloud (trigram+semantic). Document this discrepancy.
- `status.ts` fetches `from('memories').select('type')` — this fetches all rows and counts in JS. With 1000+ memories this will be slow. Note as P2.
- `recall.ts` hybrid search: semantic branch fires Ollama on `localhost:11434`. With Ollama not running, it silently falls back. Verify this fallback is silent and doesn't print a warning that confuses users.

**Tests:** After each step, verify both Supabase state (via `tages status`) and local SQLite state (file size grows).

---

### J4 — MCP Server Integration
_Effort: M_

Test the MCP server tools through Claude Code.

**Steps:**
1. Verify the MCP config entry injected by `tages init` resolves: inspect `~/Library/Application Support/Claude/claude_desktop_config.json` — confirm `command: "npx"` and `args: ["-y", "@tages/server"]` are present and env vars are set.
2. Start Claude Code in the test project directory. Run `/mcp` or check MCP tools panel — verify `tages` server is listed as connected (not error state).
3. Count loaded tools: the server registers 34 tools (per the server/index.ts). Verify that all major tool groups appear: `remember`, `recall`, `forget`, `observe`, `session_end`, `pre_check`, `file_recall`, `import_claude_md`, `detect_duplicates`, `impact_analysis`, `risk_report`, `memory_quality`, `project_health`, `fork_branch`, `merge_branch`.
4. Test `remember` via MCP: call `remember({ key: "mcp-test", value: "Testing MCP remember tool", type: "convention" })` — verify it returns success text, not an error.
5. Test `recall` via MCP: call `recall({ query: "mcp-test" })` — verify the result contains the stored memory.
6. Test `observe` via MCP: call `observe({ observation: "I decided to use pnpm workspaces because npm doesn't support workspace protocols" })` — verify it extracts at least one memory and shows it in the response.
7. Test `session_end` via MCP: call `session_end({ summary: "Built the recall command. Decided to use hybrid trigram+semantic search. Always use createAuthenticatedClient for CLI auth.", extractMemories: true })` — verify it extracts memories and lists them.
8. Test `pre_check` via MCP: call `pre_check({ taskDescription: "Add a new CLI command", filePaths: ["packages/cli/src/commands/index.ts"] })` — verify it returns gotchas from stored memories.
9. Test `file_recall` via MCP: call `file_recall({ filePaths: ["packages/cli/src/commands/status.ts"] })` — verify it returns memories linked to that path.
10. Test `import_claude_md` via MCP: pass the content of `packages/cli/CLAUDE.md` (if it exists) or a mock CLAUDE.md — verify memories are created.

**Files to read:** `packages/server/src/index.ts`, `packages/server/src/tools/remember.ts`, `packages/server/src/tools/session-end.ts`

**Known code risks to verify:**
- The MCP server starts with `npx -y @tages/server`. If the user has Node ≤ 18 or a network issue, this will fail silently from Claude Code's perspective. `tages doctor` should catch this — verify it does.
- `observe.ts` silently extracts memories. Verify the extraction logic actually fires (`packages/server/src/tools/observe.ts`) and the extracted memories appear in `recall`.
- `session_end` calls `tracker.endSession()` — if the session has no start event, this may throw. Verify graceful behavior.
- Decay timer fires every 5 minutes from server startup. Not testable in a short session, but note it.

**Tests:** After each MCP call, cross-check the result with `tages recall --all` from the CLI to confirm the memory reached the SQLite cache (SQLite is the MCP's primary read source).

---

### J5 — Dashboard
_Effort: M_

Walk the full dashboard UI.

**Steps:**
1. Navigate to `https://tages.dev/auth/login` — verify the page renders (dark background, Tages heading, "Sign in with GitHub" button). Test the button click flow.
2. After login, land on `/app/projects` — verify the project list shows the project created by `tages init`. Verify the memory count badge is accurate.
3. Click into the project — verify the Memories tab loads (MemoryTable component). Verify:
   - Skeleton loading states appear while fetching
   - All memories stored in J3/J4 are visible
   - The type filter tabs (all, convention, decision, architecture, etc.) work
   - The status filter (live/pending/all) works
   - Searching with a term (e.g., "auth") returns matching results via `recall_memories` RPC
   - Clicking a memory row opens the detail sheet (MemoryRowDetail)
4. Navigate to Decisions tab (`/app/projects/<slug>/decisions`) — verify it renders without error
5. Navigate to Activity tab (`/app/projects/<slug>/activity`) — verify ActivityFeed renders, shows recent creates/updates
6. Navigate to Pending tab — verify PendingQueue renders. If any pending memories exist from `session_end` or `observe`, verify the Verify/Reject buttons work.
7. Navigate to Execution tab (`/app/projects/<slug>/execution`) — verify ExecutionViewer renders, shows "no executions" state gracefully if empty
8. Navigate to Stats tab (`/app/projects/<slug>/stats`) — verify StatsDashboard renders with counts by type, confidence distribution
9. Navigate to Settings tab (`/app/projects/<slug>/settings`) — verify project info (slug, git_remote, default_branch) is shown. Verify TeamMembers component shows owner. Test "Invite member" flow.
10. Navigate to `/app/upgrade` — verify pricing page renders: $9/month, feature list, "Get Pro" button links to `/api/stripe/checkout`.
11. Navigate to `/app/settings/sso` — verify the Pro gate renders correctly (lock icon, "SSO / SAML is a Pro feature", upgrade link). For a Pro account, verify `SsoConfigPanel` renders.
12. Verify the project nav (`ProjectNav`) shows a pending count badge when there are pending memories. The badge is driven by a realtime subscription.

**Known code risks to verify:**
- `MemoryTable` calls `createClient()` at the component level (outside `useEffect`). This creates a new client on every render. Note as P2 UX/architecture issue.
- `ProjectNav` has no "Conflicts" or "Graph" tab — but those pages exist at `/conflicts` and `/graph`. They are accessible via direct URL but not from the nav. This is a MISSING finding.
- `/api/stripe/checkout` route exists — verify it returns a redirect to Stripe (or a graceful "not configured" message if `STRIPE_SECRET_KEY` is not set in prod) rather than a 500.
- The `decisions` page component is `DecisionTimeline` — verify this component exists and isn't a stub.

**Tests:** Screenshot or note the rendered state of each page. Note any 404s, loading spinners that never resolve, or console errors.

---

### J6 — Search Quality
_Effort: M_

Systematically test recall under various query types.

**Setup:** Ensure at least 10 memories exist across multiple types before starting.

**Steps:**
1. **Exact key match:** `tages recall "auth-pattern"` — should return the exact memory as the top result
2. **Fuzzy/partial:** `tages recall "auth"` — should return auth-related memories
3. **Value content match:** `tages recall "createAuthenticatedClient"` — should match on the value text even though that phrase isn't the key
4. **Cross-type:** `tages recall "cache"` — should return memories of different types that mention cache
5. **Type filter:** `tages recall "cache" --type architecture` — should only return architecture memories
6. **Limit:** `tages recall "the" --limit 2` — should return exactly 2 results
7. **Wildcard / list-all:** `tages recall "*"` and `tages recall --all` — both should return all live memories (the `listAll` branch in recall.ts)
8. **Case insensitivity:** `tages recall "AUTH"` — should match lowercase "auth" in values
9. **No results:** `tages recall "xyzzznotfound"` — should print the "No memories found" message, exit 0
10. **Semantic (if Ollama running):** Run `tages recall "how to authenticate"` — if Ollama is available, verify hybrid mode is reported in the output footer `(hybrid (trigram + semantic))`; if not, verify it falls back to `(trigram)` without crashing
11. **Local-only mode recall:** Switch to a local-only project config, run `tages recall "auth"` — verify it uses the SQLite `LIKE` path and returns results. Note the output header says `(local SQLite)`.
12. **MCP recall:** Call `recall({ query: "auth", type: "convention", limit: 3 })` via MCP — verify it respects type and limit filters

**Known code risks to verify:**
- The `recall_memories` Postgres RPC is called with `p_type: null` when no type filter is given. Verify the RPC handles null correctly (check `supabase/migrations/` for the RPC definition).
- Hybrid search: `semanticResult.data === null` triggers fallback to trigram label. If Ollama times out (3s timeout), it falls through cleanly. Test this timeout path explicitly by simulating a slow Ollama with `curl` timing.
- `tages recall` with no args and no `--all` currently exits with code 1 and an error. This is correct behavior, but verify the exit code is actually 1 (not 0) — some callers depend on exit codes.

**Tests:** For each query, record: result count, result keys shown, search method label in output footer.

---

### J7 — Session Workflow
_Effort: M_

Test the session-wrap command in all three modes.

**Steps:**
1. **Interactive mode:** Run `tages session-wrap` — verify the prompt appears with instructions ("Summarize what you built..."). Type a multi-paragraph summary containing decisions, conventions, and lessons. Press Enter twice to finish. Verify extracted memories are displayed in colored output. Verify they appear in `tages recall --all`.
2. **--summary flag:** Run `tages session-wrap --summary "We decided to use Zod for all MCP tool input validation. Always validate with Zod schemas. The architecture uses SQLite as primary MCP read path."` — verify it bypasses the interactive prompt, extracts memories, and stores them.
3. **--non-interactive with file:** Create `~/.config/tages/pending-session-notes.txt` with session notes containing decisions and lessons. Run `tages session-wrap --non-interactive`. Verify: the file is read and deleted, memories are extracted, output uses `[tages] <type>: <key>` format (not the colored interactive format), exit 0.
4. **--non-interactive without file:** Ensure `~/.config/tages/pending-session-notes.txt` does not exist. Run `tages session-wrap --non-interactive`. Verify: exits 0 silently, no output, no error.
5. **--non-interactive with empty file:** Create `~/.config/tages/pending-session-notes.txt` with only whitespace. Run `tages session-wrap --non-interactive`. Verify: file is deleted, exits 0 silently.
6. **Extraction quality:** Test each extraction pattern explicitly in `--summary`:
   - "decided to use X" → should extract as `decision`
   - "the convention is always use Y" → should extract as `convention`
   - "the architecture uses a layer Z" → should extract as `architecture`
   - "learned that W can cause a bug" → should extract as `lesson`
   - "created a new entity V" → should extract as `entity`
7. **No project configured:** Delete `~/.config/tages/projects/`. Run `tages session-wrap`. Verify error message is "No project configured. Run \`tages init\` first." Run `tages session-wrap --non-interactive`. Verify it exits 0 silently (hook-friendly behavior).
8. **Key collisions:** Store a memory with a long key. Run session-wrap with a summary that would generate the same slugified key. Verify the upsert doesn't error (the `INSERT OR REPLACE` in SQLite and `onConflict` in Supabase should handle it).

**Files to read:** `packages/cli/src/commands/session-wrap.ts`

**Known code risks to verify:**
- `extractMemoriesFromSummary` splits on `[.\n]` — a sentence ending with a period loses the period from the start of the next chunk. Test a summary with multiple sentences.
- Key generation: `decision-${slugify(line.slice(0, 50))}` — if two sentences start with the same 50 chars, they collide. Note as P2.
- The Supabase upsert in session-wrap uses `createAuthenticatedClient` but the SQLite path opens the DB directly without going through `SqliteCache`. This means session-wrap memories bypass the WAL and the dirty flag — they won't sync back to Supabase if the user is in cloud mode and the MCP server hasn't run. Note as P1 BUG candidate.

**Tests:** After each step, run `tages recall --all` to confirm memories were persisted to both Supabase and SQLite.

---

### J8 — Data Management
_Effort: M_

Test the data lifecycle commands.

**Steps:**
1. **export (claude-md):** `tages export` — verify a `CLAUDE.md` is written to cwd with sections for Conventions, Architecture, Decisions, Lessons, Entities. Check section headers are present.
2. **export (json):** `tages export --format json --output /tmp/tages-test.json` — verify JSON file is valid, contains all memories, includes all fields (key, value, type, file_paths, tags, confidence).
3. **export (architecture-md):** `tages export --format architecture-md` — verify `ARCHITECTURE.md` is created, only contains architecture-type memories.
4. **export (local-only mode):** Switch to local config (no supabaseUrl). Run `tages export`. Verify the error "Export requires cloud connection." with exit code 1.
5. **import (json):** Take the JSON exported above, modify two values, run `tages import /tmp/tages-test.json --strategy overwrite`. Verify changed memories are updated.
6. **import (skip strategy):** Re-run the same import with `--strategy skip`. Verify no changes are made (already-existing keys are skipped).
7. **import (markdown):** Create a markdown file with a `## Conventions` section and bullet list items. Run `tages import test.md --format markdown`. Verify memories are created.
8. **dedup:** Run `tages dedup` — verify it scans memories and reports similarity pairs at 70% threshold. Run `tages dedup --threshold 0.9` — verify fewer or no pairs are reported at the higher threshold.
9. **check (no stale):** Run `tages check` — with all file paths valid, verify "All memories are current."
10. **check (stale detection):** Store a memory with `--file-paths nonexistent-file.ts`. Run `tages check`. Verify it reports the file as deleted/missing. Run `tages check --fix` — verify the memory is marked stale in Supabase.
11. **quality (project):** Run `tages quality` — verify project health score (0-100) and distribution (Excellent/Good/Fair/Poor) is printed.
12. **quality (single memory):** Run `tages quality auth-pattern` — verify per-memory score with dimension breakdown (Conditions, Examples, Cross-refs, Tags).

**Files to read:** `packages/cli/src/commands/export.ts`, `packages/cli/src/commands/import-memories.ts`, `packages/cli/src/commands/dedup.ts`, `packages/cli/src/commands/check.ts`, `packages/cli/src/commands/quality.ts`

**Known code risks to verify:**
- `export.ts` uses `createSupabaseClient` directly (not `createAuthenticatedClient`) — it bypasses the auth session. If the user's auth token is expired, the export will silently return 0 memories. Note as P1 BUG.
- `check.ts` runs `git diff --name-only HEAD~10` — if the project has fewer than 10 commits, `HEAD~10` will fail. The `|| git diff --name-only` fallback catches this, but the fallback shows unstaged changes, not committed changes. Note the semantic difference.
- `dedup.ts` is O(n²) — with 200 memories it runs 20k comparisons. Note as P2 for large corpora.
- `quality.ts` `scoreMemory` function: the `score += 25` consistency default means every memory starts at 25/100 even with no metadata. A memory with a 1-character value and no metadata scores ~30. Evaluate whether this scoring feels meaningful.

**Tests:** Check file output contents manually and cross-reference with `tages recall --all`.

---

### J9 — Advanced Features
_Effort: L_

Test the higher-order commands.

**Steps:**
1. **index (last commit):** In the tages repo itself (which has commits), run `tages index --last-commit`. Verify it detects the LLM mode (ollama/haiku/dumb), analyzes the diff, and stores extracted memories. Print the list.
2. **index (since date):** Run `tages index --since "7 days"`. Verify it finds multiple commits, processes each one, and deduplicates results.
3. **index (install hook):** Run `tages index --install` inside a git repo. Verify `echo "tages index --last-commit" >> .git/hooks/post-commit` or equivalent is written and the hook file is executable.
4. **snapshot:** Run `tages snapshot` from the tages monorepo root. Verify it scans all TS/JS files, ignores `node_modules`/`dist`/`.next`, detects boundaries, and stores the `auto-snapshot-summary` memory. Check the output lists boundaries and top modules by line count.
5. **onboard:** Run `tages onboard` — verify the PROJECT BRIEFING output groups memories by type with the colored header format. With at least 10 memories stored from earlier journeys, verify all 5 sections (ARCHITECTURE, CONVENTIONS, DECISIONS, LESSONS, KEY ENTITIES) appear if those types exist.
6. **doctor:** Run `tages doctor` with a fully-configured project. Verify all 6 checks run: Auth config, Project config, SQLite cache, Supabase connection, Git hook, MCP server config. Verify each shows PASS/FAIL with the detail string.
7. **patterns detect:** Run `tages patterns detect` — requires 2+ projects with matching memory keys. With only 1 project, verify the "No shared patterns found" message.
8. **patterns promote + list:** Store a memory, run `tages patterns promote <key>`, then `tages patterns list` — verify the promoted pattern appears.
9. **enforce:** Run `tages enforce` — verify the "Use the MCP enforcement_report tool" stub output. Run `tages enforce check <key>` — verify it checks the memory against conventions and reports COMPLIANT or VIOLATION.
10. **analytics:** Run `tages analytics` — verify agent sessions are listed (from the MCP server starts in J4). Run `tages analytics session <id>` — verify the "Use the MCP session_replay tool" stub output. Run `tages analytics trends` — verify the stub output.

**Files to read:** `packages/cli/src/commands/index.ts`, `packages/cli/src/commands/snapshot.ts`, `packages/cli/src/commands/onboard.ts`, `packages/cli/src/commands/doctor.ts`, `packages/cli/src/commands/patterns.ts`, `packages/cli/src/commands/enforce.ts`, `packages/cli/src/commands/analytics.ts`

**Known code risks to verify:**
- `analytics.ts` `analyticsSessionCommand` and `analyticsTrendsCommand` are stubs that print "Use the MCP..." — these are MISSING: the CLI provides no actual output. Note as P2.
- `federation-cmd.ts` — all four federation CLI commands (`federate`, `federation list`, `federation import`, `federation overrides`) are stubs. Note as MISSING P2.
- `enforce.ts` `enforceCommand` (no `check` subcommand) is also a stub. Only `enforceCheckCommand` has real logic. Note as MISSING P2.
- `snapshot.ts` stores to `architecture_snapshots` table — verify this table exists in the migrations.
- `index.ts` uses `createSupabaseClient` (not `createAuthenticatedClient`) — same auth bypass as `export.ts`. Note as P1 BUG.

**Tests:** For each command, record exit code, output format, and whether the operation actually persists data.

---

### J10 — Multi-Project
_Effort: S_

Test project isolation and multi-project CLI behavior.

**Steps:**
1. Create a second temp directory, run `tages init --local --slug project-beta`. Verify a second config file `~/.config/tages/projects/project-beta.json` is created.
2. Store a memory in project-beta: `tages remember "beta-only" "This is beta project only" -p project-beta`
3. Recall from original project: `tages recall "beta-only"` (no `-p`) — verify it does NOT return the beta memory.
4. Recall from beta: `tages recall "beta-only" -p project-beta` — verify it DOES return the memory.
5. Run `tages status` (no `-p`) — verify it shows the first project (whichever `files[0]` resolves to in `getProjectsDir()`). This is the "default project" behavior — verify it's predictable (alphabetical? creation order?).
6. Run `tages status -p project-beta` — verify it shows the beta project.
7. **Isolation gap check:** In `recall.ts`, `getProjectsDir()` returns `files[0]` when no slug is given — if the user has two projects, the default is alphabetical. This is undocumented. Note as UX P2.

**Known code risks to verify:**
- All commands that use `loadProjectConfig` pick `files[0]` when no `--project` flag is given. With 2 projects, the "active project" concept is implicit and filesystem-order-dependent. This is a fundamental UX problem for multi-project users. Note as P1 UX.

**Tests:** After each step, verify the Supabase side too — memories in project-beta should have the beta `project_id`, not the original.

---

### J11 — Team Features
_Effort: M_

Test token management and RBAC (requires cloud mode).

**Steps:**
1. **token generate:** Run `tages token generate --name ci-token`. Verify: a token is printed once in bold, with the "Save this token — it cannot be shown again" warning.
2. **token list:** Run `tages token list`. Verify the token appears with name, created date, and "last used: never".
3. **token rotate:** Run `tages token rotate --name ci-token --expires-in 30`. Verify: a new token is printed, expiry date shown.
4. **token rotate (non-existent):** Run `tages token rotate --name nonexistent`. Verify error "Token 'nonexistent' not found."
5. **RBAC (invite):** On the dashboard Settings tab, use the "Invite member" form to invite a second user by email. Verify the TeamMembers component shows the invited user with their role.
6. **RBAC (read-only):** Log in as the invited user. Attempt to call the `remember` MCP tool. With RBAC enforced (migration 0031), this should be blocked for members. Verify the behavior — if RBAC is enforced at the RLS level, the MCP call should fail with a permission error.
7. **token env var (CI mode):** Set `TAGES_SERVICE_KEY=<service_role_key>` in env. Run `tages recall --all` — verify it uses the service key path (bypasses user OAuth). The `createAuthenticatedClient` function checks `TAGES_SERVICE_KEY` first.

**Files to read:** `packages/cli/src/commands/token.ts`, `packages/cli/src/auth/session.ts`, `apps/dashboard/src/components/team-members.tsx`, `apps/dashboard/src/components/invite-member.tsx`

**Known code risks to verify:**
- `tokenListCommand` calls `createSupabaseClient` without `createAuthenticatedClient` — no auth session is set. The `api_tokens` table likely has RLS that requires the user to be authenticated. This may cause an empty result or error. Note as P1 BUG.
- `tokenGenerateCommand` docs say "Use with: tages index --token <token>" and "CBM_API_TOKEN" — but neither `tages index` nor `tages recall` accept a `--token` flag in the current CLI. The env var name `CBM_API_TOKEN` looks like a leftover from an earlier name ("Codebase Memory"). Note as P1 BUG (misleading docs).
- Token rotation updates `token_hash` and `expires_at` but does not update `name` or create a new row — meaning the "old" token entry persists with a new hash. Verify `token list` still shows only one row per name after rotation.

**Tests:** Run `tages token list` before and after each token operation to track state.

---

### J12 — CLI Polish: Error Handling and Edge Cases
_Effort: M_

Stress-test the CLI under adverse conditions.

**Steps:**
1. **No network (Supabase unreachable):** Temporarily point `TAGES_SUPABASE_URL` to an invalid URL. Run `tages recall "auth"`. Verify it fails gracefully with a readable error, not a stack trace.
2. **Expired auth:** Manually edit `~/.config/tages/auth.json` to set `accessToken` to an invalid string. Run `tages recall "auth"`. Verify the refresh logic in `session.ts` fires, and if the refresh also fails, the message "Session expired. Run \`tages init\` to re-authenticate." is printed.
3. **Missing config dir:** Delete `~/.config/tages/` entirely. Run every "core" command (`remember`, `recall`, `forget`, `status`, `doctor`). Verify none crash with an uncaught exception — all should print "No project configured" with exit 1.
4. **Malformed config file:** Corrupt `~/.config/tages/projects/test.json` with invalid JSON. Run `tages recall "auth"`. Verify it throws a clear JSON parse error, not a cryptic "Cannot read properties of undefined".
5. **Large value:** Run `tages remember "big-value" "$(python3 -c 'print("x"*5000)')"` — verify it stores without error (check if there is a value length limit in the Zod schema or Supabase column).
6. **Special characters in key:** Run `tages remember "key with spaces" "test"`. Verify the key is stored and retrievable. Test with `tages forget "key with spaces"`.
7. **Duplicate key:** Run `tages remember "auth-pattern" "new value"` when `auth-pattern` already exists. Verify it updates (upsert) rather than errors.
8. **Help text coverage:** Run `tages <command> --help` for each non-trivial command: `remember`, `recall`, `session-wrap`, `index`, `snapshot`, `token generate`, `token rotate`, `patterns detect`. Verify the help text describes all options accurately.
9. **Unknown type:** Run `tages remember "test" "value" -t unknowntype`. Verify behavior — the CLI does not validate type against the enum; it will store the invalid type. Note as P2 UX (no client-side type validation).

**Known code risks to verify:**
- All `loadProjectConfig` calls use `JSON.parse(fs.readFileSync(...))` with no try/catch. A corrupt JSON config will throw an unhandled exception. This is a P1 BUG — every command is affected.
- `status.ts` fetches ALL memories to count them — no limit. With 10,000 memories this fetches 10k rows. Note as P2.
- `tages remember` default type is `'convention'` — this is hardcoded in `index.ts`. Verify it's documented in `--help`.

**Tests:** For each adverse case, record the exact terminal output and exit code.

---

### J13 — Dashboard Deep Dive
_Effort: M_

Verify the dashboard components individually.

**Steps:**
1. **Memory table search integration:** On the project page, search for a term that exists. Verify the `recall_memories` RPC is called (check Network tab) and results are rendered. Search for a term that doesn't exist — verify the empty state "No memories yet" is shown.
2. **Memory detail sheet:** Click a memory row. Verify `MemoryRowDetail` renders with: key, value (full, not truncated), type badge, confidence score, tags, file paths, created/updated dates. Verify the sheet can be closed.
3. **Pending queue:** Create a memory via `observe` (MCP) or `session_end`. On the dashboard Pending tab, verify the memory appears. Click "Verify" — verify it transitions to `status: 'live'`. Click "Reject" on another — verify it's deleted.
4. **Conflict resolver:** Intentionally create two memories with similar content (same key, different values — can be done via MCP with two different session_end calls that extract the same topic). Navigate to `/app/projects/<slug>/conflicts`. Verify `ConflictResolver` shows the conflict. Resolve it with "keep newer" — verify the older one is deleted.
5. **Memory graph:** Navigate to `/app/projects/<slug>/graph`. Verify `MemoryGraphView` renders. If memories have `cross_system_refs`, verify edges appear. With no refs, verify an empty or minimal graph state.
6. **Stats dashboard:** Navigate to `/app/projects/<slug>/stats`. Verify `StatsDashboard` shows counts, confidence distribution, and agent stats.
7. **Activity feed:** Navigate to `/app/projects/<slug>/activity`. Verify `ActivityFeed` shows create/update/delete events from the operations in J3–J9.
8. **Execution viewer:** Navigate to `/app/projects/<slug>/execution`. Verify `ExecutionViewer` renders. With no recorded flows, verify empty state is graceful.
9. **Decision timeline:** Navigate to `/app/projects/<slug>/decisions`. Verify `DecisionTimeline` renders all `type: decision` memories in chronological order.
10. **Realtime updates:** Open the project page in one browser tab and a terminal in another. Store a new memory via CLI (`tages remember`). Without refreshing the browser, verify the memory appears in the table within a few seconds (Supabase realtime subscription).
11. **Project nav missing tabs:** Verify that "Conflicts" and "Graph" routes exist (`/app/projects/<slug>/conflicts`, `/app/projects/<slug>/graph`) but do NOT appear in `ProjectNav`. Navigate directly to them — verify they work. Note as MISSING P2 (tabs should be in the nav).
12. **Responsive design:** Resize the browser to 375px width (mobile). Verify the ProjectNav tabs are horizontally scrollable (`overflow-x-auto`). Verify the MemoryTable search and filter row doesn't overflow.
13. **No JavaScript fallback:** The login page is a Client Component (`'use client'`). With JS disabled, it will render a blank button. Verify this is acceptable or note as POLISH P3.

**Files to read:** `apps/dashboard/src/components/memory-table.tsx`, `apps/dashboard/src/components/project-nav.tsx`, `apps/dashboard/src/components/memory-row-detail.tsx`, `apps/dashboard/src/components/conflict-resolver.tsx`, `apps/dashboard/src/components/memory-graph.tsx`

**Known code risks to verify:**
- `MemoryTable` `supabase` is instantiated at component scope (line 35: `const supabase = createClient()`). This means a new client is created on every component re-render. This is a React anti-pattern — `createClient()` should be inside `useMemo` or at module level. Note as P2 BUG.
- `MemoryTable` `loadMemories` is used in both `useEffect` deps arrays but is declared as a plain function (not `useCallback`), causing it to be a new reference each render. With the realtime subscription calling `loadMemories` on every DB change, this could cause infinite re-render loops. Note as P1 BUG.
- `memory-table.tsx`: when `search` changes, both the `useEffect` at line 56 (which also depends on `filter` and `statusFilter`) AND the debounced `useEffect` at line 110 fire. This means a search change triggers two load calls. Note as P2.
- The `ProjectNav` component subscribes to realtime `memories` changes (for pending count) but does not unsubscribe on slug change — if the user navigates between projects, the old subscription persists. Note as P2.

**Tests:** Use browser DevTools Network tab to verify no double-fetches or 4xx/5xx errors on any page load.

---

## Findings Log

Record findings here as you work through the journeys. Format each entry:

```
[SEVERITY][TYPE] Journey N — Short title
Description of what's wrong and how to reproduce.
File: path/to/relevant/file.ts line N
```

---

## Summary Findings (pre-identified from code review)

The following are pre-identified from reading the source — confirm or deny each during execution:

| ID | Severity | Type | Description | Location |
|----|----------|------|-------------|----------|
| F01 | P1 | BUG | `tokenListCommand` uses unauthenticated client — may return empty on RLS | `commands/token.ts:62` |
| F02 | P1 | BUG | `exportCommand` uses unauthenticated client — silently returns 0 rows if auth expired | `commands/export.ts:27` |
| F03 | P1 | BUG | `indexCommand` uses unauthenticated client — silently fails writes if auth expired | `commands/index.ts:82` |
| F04 | P1 | BUG | `loadProjectConfig` across all commands: no try/catch around `JSON.parse` — corrupt config throws uncaught exception | Multiple command files |
| F05 | P1 | BUG | `MemoryTable`: `loadMemories` not wrapped in `useCallback` — realtime subscription may cause infinite re-render loop | `components/memory-table.tsx:58` |
| F06 | P1 | UX | Multi-project default project is `files[0]` (alphabetical) — undocumented, unpredictable for users with 2+ projects | All command files |
| F07 | P1 | BUG | Token docs say `--token` flag and `CBM_API_TOKEN` env var — neither is implemented in any CLI command | `commands/token.ts:51-53` |
| F08 | P2 | MISSING | "Conflicts" and "Graph" tabs missing from `ProjectNav` despite routes existing | `components/project-nav.tsx` |
| F09 | P2 | MISSING | Federation CLI commands (`federate`, `federation list/import/overrides`) are stubs with no real logic | `commands/federation-cmd.ts` |
| F10 | P2 | MISSING | Analytics CLI (`analytics session`, `analytics trends`) are stubs | `commands/analytics.ts` |
| F11 | P2 | MISSING | `enforce` CLI (top-level, no `check`) is a stub | `commands/enforce.ts:23-33` |
| F12 | P2 | BUG | `MemoryTable`: `createClient()` called at component scope, not in effect — new instance per render | `components/memory-table.tsx:35` |
| F13 | P2 | UX | `tages recall` with no query and no `--all` exits 1 with error — but `tages recall "*"` works as list-all; discoverability gap | `commands/recall.ts:21-24` |
| F14 | P2 | UX | `status.ts` fetches all memories with no limit to count them — will be slow with large projects | `commands/status.ts:35-42` |
| F15 | P2 | UX | `session-wrap` key generation collides if two sentences start with the same 50 chars | `commands/session-wrap.ts:154-156` |
| F16 | P2 | BUG | `session-wrap` cloud upsert bypasses `dirty` flag / WAL path — session-wrap memories won't sync via MCP server's background sync | `commands/session-wrap.ts:79-91` |
| F17 | P3 | UX | `tages remember` does not validate `type` against the enum — invalid types are silently stored | `commands/remember.ts:29` |
| F18 | P3 | UX | `doctor.ts` git hook check runs in cwd — if run outside the project git repo, always reports FAIL | `commands/doctor.ts:69-72` |
| F19 | P3 | POLISH | `check.ts` `HEAD~10` fallback is unstaged diff — semantically different from "recently changed in commits" | `commands/check.ts:45` |

---

## Definition of Done

- [ ] All 13 journeys executed and findings documented in the log above
- [ ] Every pre-identified finding (F01–F19) confirmed or denied with actual reproduction steps
- [ ] New findings added to the findings log with ID, severity, type, description, and file
- [ ] Findings grouped and prioritized: P0 blockers → P1 bugs → P2 UX → P3 polish
- [ ] A follow-up fix plan drafted for all P0/P1 findings
