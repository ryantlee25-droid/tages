# Tages — Manual Validation Script + Domain Cutover Checklist

**Purpose**: Step-by-step human-executable validation for every user-facing flow, plus a complete domain cutover checklist for the `dashboard-weld-nine-65.vercel.app` → `app.tages.ai` migration.

**When to run**: Before any production release, after domain cutover, and as a smoke test after major infrastructure changes.

---

## Section 1: Pre-Validation Gate

Run these checks in sequence. All must pass before proceeding.

### 1.1 Unit + Integration Tests

```bash
cd /path/to/tages
pnpm test
```

Expected: `0 failures`. If any test fails, fix before proceeding — do not skip.

### 1.2 Type Check

```bash
pnpm typecheck
```

Expected: `0 errors`. TypeScript errors in production code are blocking.

### 1.3 Build

```bash
pnpm build
```

Expected: all packages build without error. Watch for:
- Missing exports in `packages/shared`
- CLI bundle warnings (non-fatal, but note them)
- Dashboard Next.js build errors (blocking)

### 1.4 E2E Test Files Inventory

Confirm these E2E test files exist (check `packages/cli/tests/` or `e2e/` directory):

| File | Purpose |
|------|---------|
| `e2e-free-tier-deep` | Free tier memory limit enforcement, tool gating |
| `e2e-cli-full` | Full CLI command coverage (init, recall, remember, doctor) |
| `e2e-cloud-sync` | Cloud sync round-trip: write local → verify in Supabase |
| `e2e-error-handling` | Graceful error paths (network down, bad auth, etc.) |
| `e2e-error-paths` | Edge cases: empty recall, duplicate keys, oversized values |
| `e2e-pro-gating-complete` | Pro-only tools blocked on free, unblocked after plan upgrade |

If any file is missing: escalate before continuing. Do not proceed to deployment without full E2E coverage.

---

## Section 2: Install Smoke

### 2.1 Clean Shell Install (npm registry)

```bash
# In a fresh terminal with no tages binary on PATH
npm install -g tages
tages --version
```

Expected: version string printed (e.g., `1.0.0`). No stack traces.

### 2.2 Help Output

```bash
tages --help
```

Expected: command list including at minimum: `init`, `remember`, `recall`, `doctor`, `dashboard`, `status`. Verify each command appears.

### 2.3 Binary Location

```bash
which tages
```

Expected: path under `npm` global bin (e.g., `/usr/local/bin/tages` or `~/.npm-global/bin/tages`).

### 2.4 Local Dev Install (from source)

```bash
cd packages/cli
npm link
tages --version
```

Expected: version from local build, not npm registry. Useful for pre-release validation.

---

## Section 3: `tages init` Cloud Flow

### 3.1 Run Init

```bash
tages init
```

### 3.2 Browser OAuth

- Browser should open automatically to GitHub OAuth page
- Log in with a test GitHub account (not your primary account)
- After authorization, browser should redirect and close (or show "you can close this tab")

### 3.3 Verify Auth File

```bash
cat ~/.config/tages/auth.json
```

Expected: JSON with `accessToken`, `userId`, `email` fields. File permissions should be `600`:

```bash
ls -la ~/.config/tages/auth.json
# Should show: -rw-------
```

### 3.4 Verify Project Config

```bash
ls ~/.config/tages/projects/
cat ~/.config/tages/projects/<slug>.json
```

Expected: JSON with `projectId`, `slug`, `supabaseUrl`, `supabaseAnonKey`.

### 3.5 Verify MCP Config Injection

```bash
cat ~/.config/claude/claude_desktop_config.json | grep -A5 tages
```

Expected: `tages` entry in `mcpServers` object pointing to `npx -y @tages/server` or the local binary.

### 3.6 Verify Post-Commit Hook

```bash
cat .git/hooks/post-commit
```

Expected: hook script installed (calls `tages index` or similar). File should be executable (`chmod +x`).

---

## Section 4: `tages init --local` Flow

### 4.1 Run Local Init

```bash
tages init --local
```

Expected: spinner completes without opening browser. No OAuth prompt.

### 4.2 Verify No Cloud Config

```bash
cat ~/.config/tages/projects/<slug>.json | grep supabaseUrl
```

Expected: `supabaseUrl` is empty string `""`.

### 4.3 Immediate Memory Write

```bash
tages remember test "test value"
```

Expected: success message. No network calls. Immediate response.

### 4.4 Verify SQLite DB

```bash
ls ~/.config/tages/cache/
# Should contain: <slug>.db
file ~/.config/tages/cache/<slug>.db
# Should show: SQLite 3.x database
```

### 4.5 Verify Recall Works

```bash
tages recall test
```

Expected: returns `"test value"`. Confirms SQLite round-trip.

---

## Section 5: Cloud Sync Manual Verification

Run this section only after completing Section 3 (cloud init).

### 5.1 Write a Sync Test Memory

```bash
tages remember sync-test "manual sync test" --type convention
```

Expected: success confirmation. Note the timestamp.

### 5.2 Check Sync Status

```bash
tages status
```

Expected: shows pending or synced state for `sync-test`. If sync is async, wait 30–60 seconds.

### 5.3 Verify in Dashboard

1. Open browser to `https://app.tages.ai` (or `https://dashboard-weld-nine-65.vercel.app` pre-cutover)
2. Log in with same GitHub account used in Section 3
3. Navigate to your project
4. Open Memory Browser
5. Search for `sync-test`

Expected: memory appears with:
- Key: `sync-test`
- Value: `"manual sync test"`
- Type: `convention`
- Timestamp within a few minutes of when you wrote it

### 5.4 Verify Sync is Bidirectional (optional)

1. In the dashboard, edit the memory value to `"edited in dashboard"`
2. Wait 30 seconds
3. Run `tages recall sync-test` in CLI

Expected: updated value returned. Confirms two-way sync.

---

## Section 6: Dashboard UI Checklist

Open browser devtools (F12) before starting. Keep Console tab visible.

### 6.1 Login

- Navigate to `https://app.tages.ai`
- Click "Sign in with GitHub"
- Complete OAuth flow

Expected: redirect to project list or onboarding. No error page.

### 6.2 Project List

Expected: at least 1 project visible (the one created in Section 3). Project card shows slug, memory count.

### 6.3 Memory Browser

Navigate to Memory Browser for your project.

Expected:
- Memories load without spinner stuck
- Type filters work (click "convention", list filters)
- Search bar returns results for known keys
- Clicking a memory shows detail view

### 6.4 Stats Page

Navigate to Stats.

Expected: memory count, type breakdown, activity chart render. No "NaN" or empty charts.

### 6.5 Conflicts Page

Navigate to Conflicts.

Expected: page loads. If no conflicts, shows empty state message — not a blank page or error.

### 6.6 Activity Page

Navigate to Activity.

Expected: activity feed loads. May be empty for a new project — that is acceptable.

### 6.7 Console Error Check

In browser devtools Console tab:

Expected: 0 errors (red entries). Warnings (yellow) are acceptable but should be noted.

If errors exist: capture screenshot and report before proceeding.

---

## Section 7: Auth Token Expiry Manual Test

This validates graceful degradation when credentials are missing.

### 7.1 Delete Auth File

```bash
rm ~/.config/tages/auth.json
```

### 7.2 Attempt Recall

```bash
tages recall foo
```

Expected: human-readable error message. Acceptable messages:
- "Not authenticated. Run `tages init` to connect your project."
- "Auth token not found. Please run `tages init`."

Not acceptable:
- Stack trace printed to stdout
- `Cannot read properties of undefined`
- Silent failure (empty output)

### 7.3 Attempt Remember

```bash
tages remember auth-test "value"
```

Expected: same graceful error as above (not a crash).

### 7.4 Re-init

```bash
tages init
```

Expected: full OAuth flow restores auth. Subsequent commands work normally.

---

## Section 8: `tages doctor` Validation

### 8.1 Configured Project (should PASS)

In a directory where `tages init` was already run:

```bash
tages doctor
```

Expected output (all checks green):
```
[PASS] Auth token present
[PASS] Project config found
[PASS] Supabase connectivity
[PASS] MCP config injected
[PASS] SQLite cache accessible
```

If any check FAILS in a configured project: investigate before releasing.

### 8.2 Unconfigured Directory (should FAIL informatively)

```bash
mkdir /tmp/tages-fresh-dir
cd /tmp/tages-fresh-dir
tages doctor
```

Expected output (failures with guidance):
```
[FAIL] Project config not found — run `tages init` in this directory
[FAIL] MCP config not injected — run `tages init` to configure Claude Code
```

Not acceptable:
- Crash or stack trace
- Silent output (nothing printed)
- Unhelpful message like "Error: undefined"

---

## Section 9: MCP Integration Smoke

Requires Claude Code with the tages MCP server configured (done by Section 3).

### 9.1 Store a Memory via MCP

In Claude Code, send this prompt:

> "Use tages to store the memory that we use pnpm as our package manager."

Expected:
- `remember` tool is called (visible in tool use sidebar)
- Tool returns a confirmation message
- No error overlay in Claude Code

Verify in CLI:
```bash
tages recall package-manager
# or
tages recall pnpm
```

Expected: returns the stored memory.

### 9.2 Retrieve a Memory via MCP

In Claude Code, send this prompt:

> "What package manager do we use?"

Expected:
- `recall` tool is called (or memory is returned via context)
- Response includes "pnpm" with citation to the stored memory
- No "I don't have information about" response (that indicates recall failed)

### 9.3 Pro Tool Gating (free tier)

In Claude Code on a free-tier project, request a Pro-only tool (e.g., `tages sharpen` or `tages enforce`).

Expected:
- Tool returns upgrade message pointing to `https://app.tages.ai/upgrade`
- Message is readable: "This tool requires Tages Pro. Upgrade at https://app.tages.ai/upgrade"
- No crash or silent failure

---

## Section 10: Domain Cutover Checklist

### 10.1 Source Code Changes Required

The following files contain hardcoded references to `dashboard-weld-nine-65.vercel.app` that must be updated to `app.tages.ai`:

| File | Line(s) | Current Value | Target Value | Category |
|------|---------|---------------|--------------|----------|
| `packages/server/src/tools/remember.ts` | 34 | `https://dashboard-weld-nine-65.vercel.app/upgrade` | `https://app.tages.ai/upgrade` | source |
| `packages/server/src/tier-gate.ts` | 8 | `https://dashboard-weld-nine-65.vercel.app/upgrade` | `https://app.tages.ai/upgrade` | source |
| `packages/cli/src/commands/init.ts` | 11 | `https://dashboard-weld-nine-65.vercel.app` (fallback) | `https://app.tages.ai` (fallback) | source |
| `packages/cli/src/commands/migrate.ts` | 10 | `https://dashboard-weld-nine-65.vercel.app` (fallback) | `https://app.tages.ai` (fallback) | source |
| `packages/cli/src/commands/dashboard.ts` | 5 | `https://dashboard-weld-nine-65.vercel.app` (fallback) | `https://app.tages.ai` (fallback) | source |
| `apps/dashboard/src/app/robots.ts` | 10 | `https://dashboard-weld-nine-65.vercel.app/sitemap.xml` | `https://app.tages.ai/sitemap.xml` | source |
| `apps/dashboard/src/app/sitemap.ts` | 6 | `https://dashboard-weld-nine-65.vercel.app` | `https://app.tages.ai` | source |
| `apps/dashboard/src/app/sitemap.ts` | 12 | `https://dashboard-weld-nine-65.vercel.app/auth/login` | `https://app.tages.ai/auth/login` | source |
| `apps/dashboard/src/app/sitemap.ts` | 18 | `https://dashboard-weld-nine-65.vercel.app/security` | `https://app.tages.ai/security` | source |
| `apps/dashboard/src/app/sitemap.ts` | 24 | `https://dashboard-weld-nine-65.vercel.app/examples` | `https://app.tages.ai/examples` | source |
| `apps/dashboard/src/app/sitemap.ts` | 30 | `https://dashboard-weld-nine-65.vercel.app/pricing` | `https://app.tages.ai/pricing` | source |

### 10.2 Supabase URL References

The following files contain `wezagdgpvwfywjoxztfs.supabase.co` as a fallback. This is the production Supabase URL and should **not** be changed — it is the correct value. However, it should eventually be sourced from environment variables only, not hardcoded:

| File | Line(s) | Current Value | Note | Category |
|------|---------|---------------|------|----------|
| `packages/cli/src/commands/init.ts` | 12 | `https://wezagdgpvwfywjoxztfs.supabase.co` | Production Supabase URL — correct value, keep | infra |
| `packages/cli/src/commands/migrate.ts` | 11 | `https://wezagdgpvwfywjoxztfs.supabase.co` | Production Supabase URL — correct value, keep | infra |

### 10.3 Hardcoded Supabase Anon Keys

The following files contain a hardcoded Supabase anon key as a fallback. Anon keys are safe to expose publicly (they are client-side keys with RLS enforcement), but the hardcoded value is a code smell. Reference as environment variable in the long term:

| File | Line(s) | Current Value | Note | Category |
|------|---------|---------------|------|----------|
| `packages/cli/src/commands/init.ts` | 13 | `eyJhbGci...` (JWT anon key) | Environment variable reference — `TAGES_SUPABASE_ANON_KEY` | infra |
| `packages/cli/src/commands/migrate.ts` | 12 | `eyJhbGci...` (JWT anon key) | Environment variable reference — `TAGES_SUPABASE_ANON_KEY` | infra |

### 10.4 Infrastructure Changes

Complete these infrastructure steps in order:

| Step | System | Action | Notes |
|------|--------|--------|-------|
| 1 | Vercel | Assign custom domain `app.tages.ai` to the dashboard project | DNS: add CNAME or A record pointing to Vercel |
| 2 | Vercel | Set `NEXT_PUBLIC_SITE_URL=https://app.tages.ai` in environment variables | Applies to Production environment |
| 3 | Vercel | Set `TAGES_DASHBOARD_URL=https://app.tages.ai` in environment variables | Used by CLI env override |
| 4 | Supabase | Authentication → Site URL → change to `https://app.tages.ai` | Required for OAuth redirect to work |
| 5 | Supabase | Authentication → Redirect URLs → add `https://app.tages.ai/**` | Wildcard covers all dashboard routes |
| 6 | Supabase | Authentication → Redirect URLs → keep `https://dashboard-weld-nine-65.vercel.app/**` during transition | Remove after cutover confirmed |
| 7 | npm | Update `README.md` dashboard links in npm package description | Run before next npm publish |
| 8 | GitHub | Update repo `README.md` with `app.tages.ai` links (Sections: Works With, Dashboard) | Open PR, merge before cutover |

### 10.5 Cutover Order

Execute in this sequence to minimize downtime:

1. Merge all source code changes (Section 10.1) to main
2. Deploy updated dashboard build to Vercel
3. Assign `app.tages.ai` custom domain in Vercel
4. Wait for DNS propagation (TTL-dependent, typically 5–30 min)
5. Update Supabase Site URL and Redirect URLs
6. Verify OAuth login works at `https://app.tages.ai`
7. Publish new CLI version to npm with updated fallback URLs
8. Update README and docs

### 10.6 Post-Cutover Sentinel Test

**Important**: H5's URL sentinel assertion checks for `dashboard-weld-nine-65.vercel.app` in the codebase as a guard against stale URLs. After domain cutover, that assertion will fail because the old URL has been replaced.

After cutover, update H5's sentinel to assert `app.tages.ai` instead:

- Find the sentinel in H5's E2E test file (`e2e-url-sentinel` or similar)
- Change the expected URL from `dashboard-weld-nine-65.vercel.app` to `app.tages.ai`
- Re-run `pnpm test` to confirm the sentinel goes green

Leaving the sentinel pointing to the old domain after cutover will produce a false-failing test on every CI run.

### 10.7 Rollback Plan

If cutover fails:

1. Revert Supabase Site URL to `https://dashboard-weld-nine-65.vercel.app`
2. Remove `app.tages.ai` CNAME/A record (or point it elsewhere)
3. Old Vercel deployment URL continues to work (Vercel keeps old deployment live)
4. Revert CLI npm publish if the new version was released
5. Investigate failure before retrying

---

## Quick Reference: All Occurrences Found

Total `dashboard-weld-nine-65.vercel.app` occurrences: **11** across 7 files.
Total `wezagdgpvwfywjoxztfs.supabase.co` occurrences: **2** across 2 files (plus 2 anon key occurrences).

```
grep -rn "dashboard-weld-nine-65.vercel.app" . --include="*.ts" --include="*.tsx" \
  | grep -v "node_modules|dist|build"
# → 11 matches

grep -rn "wezagdgpvwfywjoxztfs.supabase.co" . --include="*.ts" \
  | grep -v "node_modules|dist|build"
# → 2 matches
```
