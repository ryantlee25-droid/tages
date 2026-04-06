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
