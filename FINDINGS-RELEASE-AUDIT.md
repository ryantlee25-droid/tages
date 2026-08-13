# Tages Release Audit, Findings

_2026-08-12. Full-repo + full-machine audit against the goal: **a Mersive engineer signs up, joins Ryan's project, and recalls memories captured the night before.** Five parallel research streams (release/distribution, onboarding UX, capture→sync→recall, test/quality, machine sweep). Every finding below carries file:line evidence and was verified against the working tree, the live prod database, the live dashboard, or the published npm tarballs._

---

## 0. Verdict

**The v0.3.0 "team-readiness" release is tagged but not distributed, and the onboarding path it documents does not work end to end.** The code is good; the last mile is missing. Four independent classes of failure:

1. **Nothing shipped.** npm still serves cli 0.2.1 / server 0.1.1, published 2026-04-10. Every team-readiness feature, `tages link --project-id`, the harness, chunk-aware recall, is absent from what a teammate would install.
2. **The published CLI is structurally broken** (ESM/CJS defect, pre-existing since 0.2.1). `tages remember` cannot run from an npm install.
3. **Two live security holes** on the highest-volume paths: an unbound privilege-escalation RPC and RLS bypass on all four recall functions.
4. **The literal goal, "memories from last night", is unimplemented.** The harness never produces recallable memories, and `"last night"` is not a recognized temporal expression.

Production itself is healthy: `ACTIVE_HEALTHY`, migrated to 0064 (matches the repo's 64 files exactly), dashboard live. But `team_members` is **empty**, nobody has ever joined a project, and the `tages` project's newest memory is **2026-04-19**. The dogfood never started.

---

## 1. SECURITY, act on these regardless of the release

### S1. Prod `service_role` key is world-readable and in every process env, CRITICAL
`~/.zshrc` line 35 exports `TAGES_SERVICE_KEY`, mode `0644`. Decoded: `role=service_role`, ref `wezagdgpvwfywjoxztfs`, expires 2036. This key **bypasses all RLS**. It has been exported into every shell, subprocess, and agent session since April; assume it is echoed in `~/.claude/projects` transcripts (148 Tages session dirs, 465M).

Byte-identical to the `service_role` entry in `~/.config/tages/.prod-keys.json`. **Deleting the cache file does not close this**, the key must be rolled in the Supabase dashboard.

Also world-readable with live credentials:

| Path | Mode | Contents |
|---|---|---|
| `~/projects/tages/.env.eval` | 0644 | `OPENAI_API_KEY`, `VOYAGE_API_KEY` |
| `~/projects/tages/eval/longmemeval/.env` | 0644 | `OPENAI_API_KEY` |
| `~/.config/tages/auth.json` | 0644 | Tages accessToken + refreshToken |
| `~/.config/tages/.prod-keys.json` | 0600 | 4 prod keys incl. `sb_secret_*` |
| `~/.config/tages/.dev-keys.json` | 0600 | 4 dev keys |

**Repo history is clean.** All 409 commits scanned for `sk-ant-`, `sk-proj-`, `sk_live_`, `sbp_`, `sb_secret_`, `service_role.*eyJ`, every hit resolves to redaction patterns in `packages/shared/src/safety.ts` or their tests. No live credential is committed.

### S2. `accept_pending_invites` is an unbound privilege escalation, CRITICAL
`supabase/migrations/0055_invite_expiry.sql:17-33`. `SECURITY DEFINER`, `GRANT EXECUTE ... TO authenticated`, signature `(user_email text, uid uuid)`. Both parameters are caller-supplied and **neither is bound to `auth.uid()` or the JWT email claim**:

```sql
UPDATE team_members SET user_id = uid, status = 'active'
 WHERE email = user_email AND status = 'pending' ...
```

Any authenticated user can call `accept_pending_invites('victim@mersive.com', <their own uid>)`, claim someone else's pending invite, and become `status='active'`, which immediately satisfies `is_project_member` and grants full read of that project's memories. Signup is self-serve GitHub OAuth, so "any authenticated user" means anyone on the internet.

**Fix:** drop both parameters; use `auth.uid()` and `auth.jwt()->>'email'` inside the function. ~5-line migration.

### S3. All four recall RPCs bypass RLS, HIGH
Verified case-insensitively:

**CORRECTED 2026-08-12 after implementation.** My first pass cited the line where each `security definer` clause appears, which is the END of a function, and mapped two of them to the wrong function. The LIVE definitions, which is what a `CREATE OR REPLACE` must carry forward, are:

| Function | LIVE definition | Guard |
|---|---|---|
| `recall_memories` | `0061_word_similarity_recall_fix.sql:73-130` | `security definer`, **none** |
| `semantic_recall` | `0060_temporal_date_anchoring.sql:136-184` (NOT 0061) | `security definer`, **none** |
| `hybrid_recall` | `0062_hybrid_recall_rrf_fusion.sql:77-177` | `security definer`, **none** |
| `chunk_semantic_recall` | `0064_chunk_aware_recall.sql:56-129` | `security definer`, **none** |

**Trap this exposes:** `hybrid_recall` is defined in BOTH 0061 (older `UNION ALL`/`DISTINCT ON` form) and 0062 (RRF fusion, which supersedes it). Carrying forward 0061's body would silently revert the RRF fusion shipped in PR #72 while looking like a pure security patch. Any future edit to these functions must start from the live definition, not the first grep hit.

All filter solely on the caller-supplied `p_project_id`. `0051_team_rbac_hardening.sql:142,180` added exactly the missing guard (`p.owner_id = auth.uid() OR is_project_member(auth.uid(), p.id)`) to two *other* RPCs and skipped the recall path, the highest-volume data egress in the product.

**Consequence:** the project UUID is a de-facto bearer token for every memory in the project. This interacts badly with S4 below, where the documented join mechanism is *pasting the UUID into Slack*.

### S4. The UUID is both a secret and a thing you must broadcast
`docs/team-onboarding.md:43` tells the owner to read the project UUID from `tages status` or the dashboard. **Neither prints it**, `packages/cli/src/commands/status.ts:62-116` uses `config.projectId` only as a query filter; `settings/page.tsx:56-57` renders slug and created-date only. The only source is `cat ~/.config/tages/projects/tages.json`. So the intended flow is a manual Slack paste of a value that S3 makes equivalent to a password.

---

## 2. RELEASE BLOCKERS, why nothing is installable

### R1. Nothing was ever published
| Package | Repo | npm | Published |
|---|---|---|---|
| `@tages/cli` | 0.3.0 | **0.2.1** | 2026-04-10 |
| `@tages/server` | 0.2.0 | **0.1.1** | 2026-04-10 |
| `@tages/shared` | 0.1.2 | **0.1.1** | 2026-04-10 |
| `@tages/{cursor,codex,gemini}-plugin` | 0.1.0 | **E404** | never |
| `@tages/harness-claude-code` | 0.1.0 | **E404** | never |

`publish.yml` E403'd on the first step (`@tages/shared`) with *"Two-factor authentication or granular access token with bypass 2fa enabled is required."* Fail-fast skipped steps 2-6, so **nothing published and a re-run is safe today**, but the workflow has six sequential unguarded steps with no version-exists check, so it is not idempotent in general.

Unpacking the published `@tages/cli@0.2.1` confirms **zero** occurrences of `project-id`, no `linkByProjectId`, no `harness` command. A teammate running the documented `tages link --project-id <uuid>` gets `error: unknown option '--project-id'`.

### R2. The CLI tarball cannot execute, pre-existing defect, not a 0.3.0 regression
`packages/cli/tsconfig.json:9` sets `"rootDir": "../../"`, so `tsc` emits the CLI to `dist/packages/cli/src/**` and drags compiled sibling packages along: the 0.3.0 tarball is 228 files, 194 `cli/`, 30 `server/`, 2 `harness-claude-code/`.

Those siblings are **CJS** (`module: Node16`, no `"type"` field), landing inside a package that declares `"type": "module"` (`packages/cli/package.json:5`). Node parses them as ESM. Verified against the extracted tarball:

```
FAIL dist/packages/server/src/cache/sqlite.js  -> ReferenceError: exports is not defined in ES module scope
FAIL dist/packages/harness-claude-code/src/local-log.js -> same
FAIL dist/packages/server/src/drift/index.js   -> same
```

Compounding: `packages/cli/src/sync/cli-sync.ts:20-29` walks up 10 levels for `packages/server/dist/cache/sqlite.js`, a path that never exists in an npm install (the tarball ships `dist/packages/server/src/`). Throws `Failed to load server modules` (`cli-sync.ts:46`). The dynamic-import fallback at `:36-44` is **dead code**, guarded by `existsSync` on the path the loop already proved exists.

**Breaks:** `remember`, `forget`, `import`, `import-memories`, `index`. **Survives:** `recall` (talks to Supabase directly). A teammate can recall but cannot remember. This is exactly `docs/team-onboarding.md:72-73`, the sanctioned smoke test: line 72 fails, line 73 passes.

### R3. `@tages/harness-claude-code` is required but not in the publish matrix
`publish.yml:27-44` publishes shared, server, cli, and the three plugins. The harness package is absent. But `packages/cli/src/commands/harness.ts:131-150` resolves the hook binary via `require.resolve('@tages/harness-claude-code')` (not a CLI dependency, not on npm) then a monorepo-only path walk. Returns `null` → `tages harness enable` fails for every npm user.

### R4. Packaging hygiene
- **No README ships** with cli/server/shared. `files` lists `"README.md"` (`packages/cli/package.json:9-12`) but no such file exists in those directories. npmjs.com will render blank for the flagship CLI.
- **Tests ship in every tarball**: server 148/338 files (44%), cli 60/228. Cause: every `tsconfig.json` uses `"include": ["src/**/*"]` with no test exclusion. Scanned the shipped test JS for credentials, all dummies, no live secrets. Bloat, not disclosure.
- `workspace:*` **resolves correctly**, pnpm rewrites to the exact pin `0.1.2`, and publish order (shared→server→cli) is correct and fail-fast-enforced.
- `id-token: write` is granted (`publish.yml:10`) but no step passes `--provenance`. Dead permission; turning provenance on would also help with npm's auth requirements.

### R5. SBOM failure was a transient GitHub 503, not release-blocking
Run 29709413288, last step (`sbom.yml:50-53`, `softprops/action-gh-release@v3`): `Unexpected error fetching GitHub release for tag refs/tags/v0.3.0: HttpError: No server is currently available`. The SBOM itself **generated successfully**. Side effect: there is **no v0.3.0 GitHub release object**, `gh release list` shows only v0.1.0. A re-run will create a bare release with an empty body; write notes first if you want them (`README.md:150` has a usable 0.3.0 section).

---

## 3. ONBOARDING BLOCKERS, the path a teammate walks

### O1. `tages init` configures Claude **Desktop**, not Claude Code, CONFIRMED
`packages/cli/src/config/paths.ts:31-40` returns `~/Library/Application Support/Claude/claude_desktop_config.json`. The JSDoc directly above it claims *"the path to the Claude Code MCP settings file."* Claude Code reads `~/.claude.json` or a project `.mcp.json`; grep confirms **nothing in the repo ever writes either**. `tages init` prints "MCP config: ...(created)" and `/mcp` in Claude Code shows nothing. For a Claude-Code-only cohort this breaks the whole wiring step.

### O2. `tages link --project-id` never wires the agent
`packages/cli/src/commands/link.ts:204-249` writes the project JSON and `.tages/config.json`, then stops. It never calls `injectMcpConfig()` or `installPostCommitHook()`, both of which `init` does (`init.ts:131-139`). Even once published, the joiner gets a project binding and no agent wiring.

### O3. A teammate who follows the dashboard's own advice gets wedged
`supabase/migrations/0001_initial_schema.sql:17` makes `slug` **globally unique across all owners**. The `/app/projects` empty state (`projects/page.tsx:51-64`) tells a brand-new user to run `npm install -g @tages/cli && tages init`, the wrong instruction for a joiner. Two failure modes:

- **CLI path:** `createCloudProject` checks for an existing row filtered by `owner_id = B` (`project-factory.ts:24`), finds none, INSERTs, hits the unique violation. The handler at `:53-54` matches `msg.includes('violates')` and throws **"Free tier is limited to 2 projects. Upgrade to Pro."**, a wrong diagnosis that sends B to a billing page. (Wrong twice: the real RLS policy caps free at **1** project, `0002_rls_policies.sql:47-55`.)
- **MCP path:** `resolveProject` Strategy 4 (`config.ts:209-249`) auto-creates, catches the same violation at `:232-235`, and **silently falls back to local-only mode**, writing a config that permanently shadows the real project. `tages link --project-id` then *refuses to overwrite it* (`link.ts:234-239`), wedging B until they delete the file by hand.

This is the single most likely thing to happen tomorrow.

### O4. Invited teammates are read-only, and the failure is silent
`is_write_authorized` (`0031_rbac_write_policies.sql:14-25`) requires `role in ('owner','admin')`. Both invite paths default to `member` (`invite.ts:12`, `invite-member.tsx:16`). B's `remember`/`observe` succeed against local SQLite (`sqlite.ts:233`), the remote flush fails to stderr only (`supabase-sync.ts:194-197`), and rows stay `dirty=1` forever. **B believes they are contributing; nothing lands.**

### O5. Free tier caps the dogfood at two teammates
`seat_limit_for_project` returns 2 for free (`0051:101-117`), enforced by a BEFORE UPDATE trigger on `status → active` (`:72-89`). Owner isn't counted, so Ryan + 2. Engineer #3 hits `Seat limit reached for this project plan`.

### O6. `tages team invite` sends no email
`packages/cli/src/auth/invite.ts:21-32` inserts a pending `team_members` row and stops. The *dashboard* invite (`app/api/projects/[id]/invite/route.ts:167-206`) does send a real Supabase magic link. The CLI path silently notifies nobody.

### O7. Domain split
Docs say `tages.ai` (`collaborator-onboarding.md:21,36`, `quickstart.md:27`); all CLI/server constants hardcode `app.tages.ai` (`init.ts:11`, `link.ts:43`, `dashboard.ts:5`, `tier-gate.ts:8`). Both return 200, but `tages dashboard` opens a different host than every doc. `e2e-pro-gating-complete.test.ts:99` carries a `SENTINEL: update after domain cutover` comment, the cutover the docs describe as complete has not happened. `NEXT_PUBLIC_APP_URL` does not exist anywhere; the URL is hardcoded.

**Verified working:** GitHub OAuth signup is live and self-serve (`enable_signup = true`, `supabase/config.toml:46`), no waitlist, no Stripe gate. **PKCE is fixed**, `/auth/cli` sets the code verifier with `SameSite=lax` and `/auth/callback` is same-origin, so the round trip survives. The `/auth/cli-token` copy-paste page still exists but is no longer needed.

---

## 4. THE ACTUAL GOAL, "pull down memories from last night"

### G1. The harness produces no recallable memories
Capture works: hooks → normalize → redact → cap 500 chars → local SQLite at `~/.config/tages/cache/<slug>-harness.db` → **manual** `tages harness sync` → Supabase `harness_tool_events`.

**`harness_tool_events` has zero consumers.** No distillation job, no dashboard reader, no MCP tool, no recall path. Even `tages drift` reads `field_changes`/`memories`/`tool_call_log` (`drift.ts:103,126,164`), never this table. It is a write-only telemetry log. Confirmed empty on prod (0 rows).

### G2. `"last night"` is not a temporal expression
`packages/server/src/search/temporal-query.ts` `STRONG_KEYWORDS` contains `yesterday`; not `last night`, `tonight`, or `last week`. `RELATIVE_PATTERN` matches `last <weekday>` only. So `isTemporalQuery("what did we do last night")` → `false` → the temporal channel issues zero queries. And **no date filter is exposed anywhere**: `tages recall` offers only `--type/--limit/--project/--all/--assembled-context`; the MCP schema registers `query/type/limit/maxTokens/assembledContext`. The temporal channel only *reorders* by proximity, it never filters.

### G3. Encryption has no key distribution
`getEncryptionKey()` reads `process.env.TAGES_ENCRYPTION_KEY` and nothing else (`packages/server/src/crypto/encryption.ts:9`). No keyfile, no per-project key, no `tages key` command, no KMS. Three failure modes:

- **B has no key:** `recall.ts:29` substitutes the literal string `[ERROR: memory is encrypted but TAGES_ENCRYPTION_KEY is not set]` **as the memory value**. The tool call succeeds; the agent consumes garbage that reads like content.
- **B has a wrong key:** `decipher.final()` throws (`encryption.ts:38`). `decryptMemories` (`recall.ts:23-36`) has **no try/catch**, and neither does the call site, **one undecryptable row fails the entire recall call**, not just that row.
- **CLI never decrypts at all:** `packages/cli/src/commands/recall.ts:361` prints `row.value` verbatim → the user sees `enc:v1:...`. No encryption import exists anywhere in `packages/cli`.

Asymmetry: MCP writes encrypt, CLI writes don't, the same project accumulates mixed plaintext and ciphertext rows.

### G4. There is no periodic pull; B goes stale silently
`startSync()` is **push-only** (`supabase-sync.ts:151-154`, a `setInterval` over `flush()`). Hydration is startup-only behind a 60s TTL (`index.ts:68,181-189`). A session opened at 9am never sees a 10am write.

Worse, `handleRecall` returns early on **any** local hit (`recall.ts:67`, `scoredResults.length > 0`, satisfied by a substring `LIKE '%query%'`), so remote/rerank/temporal are never reached. The freshness guard is a **row-count equality check** (`supabase-sync.ts:96-106`), not a content check: B with 5 unsyncable local captures against a server holding 5 of Ryan's gets "Cache is current" and **never sees Ryan's memories**. There is no `tages pull`; the only remedy is restarting the agent or deleting the SQLite file.

### G5. `observe` promotions never reach the remote, same bug class as PR #70
`remoteInsert` strips `id` (`supabase-sync.ts:266`) so Supabase assigns its own UUID while the local row keeps a `randomUUID()`. Two call sites then update the remote **by local id**:
- `packages/server/src/tools/observe.ts:120`, `.eq('id', memory.id)` promoting to `status='live'`. **Matches nothing.** The row stays `pending`, and every recall path filters `status='live'` (`0061:115`). B never sees it.
- `packages/server/src/tools/verify.ts:28` → `remoteVerifyMemory` (`supabase-sync.ts:530-544`), same defect.

This repo's own `CLAUDE.md` instructs using `observe` for passive capture, so the default capture convention lands in `pending` and, if auto-save fires, never gets promoted remotely.

### G6. Other silent-loss paths
- **Green success on failed sync:** `_flushMemories` logs and returns on error (`supabase-sync.ts:194-197`); `cli-sync.ts:112-119` swallows; `remember.ts:137` still prints `Stored:` in green.
- **`hydrate()` has no `.limit()`** (`:128-131`) → PostgREST's 1000-row cap silently truncates, and `setLastSyncedAt` records the truncated count, so the freshness check is permanently false and every start re-pulls, still truncated.
- **Only SIGINT is handled** (`index.ts:822-831`); MCP clients generally SIGTERM. The memory row survives (synchronous `remoteInsert`) but the fire-and-forget embedding and chunk writes are lost → recallable by trigram, invisible to semantic search. Same class as the long-input embedding bug.
- **CLI writes have no crash WAL** (`cli-sync.ts:100` passes no `walPath`; only the MCP server does).

### G7. Zero test coverage for the goal
Across 109 test files: no test asserts a second identity can read a first identity's memory. Grep for `cross-user|cross-machine|teammate|second developer|another user` → **zero hits**. No test uses two different encryption keys. No test exercises a date-scoped query. The closest is `e2e-cloud-sync.test.ts:202` ("hydrate() loads Supabase rows into a fresh SQLite cache"), same user, same auth, no encryption, and the whole suite is `describe.skipIf(!process.env.TAGES_E2E_SUPABASE_URL)`, so it does not run in CI or locally.

---

## 5. PRODUCTION STATE (verified live)

| Check | Result |
|---|---|
| Prod `wezagdgpvwfywjoxztfs` | `ACTIVE_HEALTHY`, REST 200, Auth 200 |
| Migrations | **0064** applied; matches the repo's 64 files exactly, no gap |
| Dashboard | Live at `https://tages.ai` (Vercel project `dashboard`), `/auth/login` 200 |
| Dev `ugogdqzhhnuzwgcaovty` | **INACTIVE** (paused) |
| `projects` | 5, tages, the-remnant, docgen-cloud, h2-test, longmemeval-sandbox |
| `memories` | 137 total; **newest in the `tages` project is 2026-04-19** |
| `team_members` | **0 rows, nobody has ever joined a project** |
| `memory_chunks` | **0 rows**, chunk retrieval (0063/0064) shipped with no data; the channel is inert on prod |
| `harness_tool_events` | 0 rows |
| `api_tokens` / `agent_sessions` / `user_profiles` | 1 / 1 / 4 |

**Three eval projects wrote into prod, not dev:** `docgen-cloud`, `the-remnant`, `longmemeval-sandbox`. Deleting their local configs orphans the server-side rows, tear down server-side first.

Free tier auto-pauses after 7 days idle. `.github/workflows/supabase-keepalive.yml` exists **untracked**, so it has never run.

---

## 6. MACHINE STATE

**Unpushed work that deletion would destroy**, 4 local-only branches:

| Branch | Commits ahead | Last | Tip |
|---|---|---|---|
| `feat/two-stage-retrieval` | **20** | 2026-07-11 | full-context no-Tages baseline backend |
| `howler/gemini-plugin` | 4 | 2026-04-20 | `@tages/gemini-plugin` |
| `feat/multi-agent-instrumentation` | 3 | 2026-06-25 | harness auto-attribution on boot |
| `howler/agents-md-diff-federate` | 3 | 2026-04-20 | agents-md diff + federate |

Plus **3 stashes**, all unmerged. `stash@{0}` (eval WIP) pairs with `feat/two-stage-retrieval`.

The other 42 local branches are safe, their tips are contained in remote refs.

**Disk:** `~/projects/tages` 7.3G (4.5G in 5 attached worktrees, 681M node_modules). `~/projects/remnant/.claude/worktrees` holds **39 worktrees / 8.4G**, the largest single item, not yet audited for unpushed commits. `~/.config/tages/cache` 123M across 507 SQLite files.

**Installed CLI:** `tages` is an npm-link dev shim pointing straight at the working tree (`~/projects/tages/packages/cli/dist/...`), nothing shadows local changes. But `tages --version` prints **0.2.0** because `packages/cli/src/index.ts:54` hardcodes the literal while `package.json` says 0.3.0. The shipped v0.3.0 CLI reports 0.2.0. Repo-root `package.json` is also still 0.2.0.

**Embedder:** Ollama installed but **not running**; `OPENAI_API_KEY` **not set** in the environment. Every embed call today either falls back to OpenAI using a key from a `.env` file or fails, raising the odds of the silent-no-op embedding class.

**Config bindings:** 11 project configs in `~/.config/tages/projects/`; 9 are stale temp/eval bindings, 3 of them pointed at **prod**.

---

## 6b. TEST + QUALITY STATE (measured, not claimed)

**The code itself is in good shape.** This is the one area with no bad news.

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS, lockfile resolves |
| `pnpm -r build` (8 packages incl. dashboard) | **PASS**, zero errors |
| `pnpm -r typecheck` + dashboard `tsc --noEmit` | **PASS**, zero type errors |
| Full vitest suite, all packages | **PASS, 1,228 passing / 13 skipped / 0 failures** |
| `apps/dashboard` `next build` | PASS, 22/22 pages, Turbopack clean |
| `pnpm lint` | **FAIL, `eslint: command not found`** |

The "1,228 tests / 13 skipped" figure is **confirmed exactly** at source level (817 server + 343 cli + 31 shared + 34 harness + 16 plugins). A naive `pnpm -r test` reports 1,257 today because the three plugin packages have **no `vitest.config.ts`**, so after a build vitest runs each suite twice, once from `src/*.test.ts`, once from compiled `dist/*.test.js`. Artifact, not regression.

### Q1. Lint is non-functional across the entire repo
- **Root:** `package.json` declares `"lint": "eslint ."` but has **no `eslint` devDependency**. The script has never been runnable.
- **Dashboard** (the only package with an eslint config): ESLint 10.2.0 + `eslint-plugin-react` 7.37.5 are incompatible, `react/display-name` throws `TypeError: contextOrFilename.getFilename is not a function`. Lint crashes before completing.

Nothing in this repo has actually been linted. That is a blind spot, not a pass.

### Q2. The critical path is the least-covered code
`packages/server/src/sync` is **35.15%** statements, `supabase-sync.ts` at 33.75%, `auto-save.ts` at 52.63%. This is precisely the code that persists `remember` to Supabase and hydrates `recall` from it (dirty flag, flush, hydrate). Its integration coverage lives **entirely** in the 13 skipped `e2e-cloud-sync` tests, so **the remember→cloud→recall round trip has effectively zero coverage in a normal CI run.**

Also thin on the critical path: `packages/cli/src/auth/session.ts` **16.66%**; `contextual-recall.ts` 72%, `observe.ts` 70%, `resolve-conflict.ts` 67%.

Package totals: server 82.4%, cli 69.0%, shared 77.1%, harness 93.0%, plugins 5–32%.

### Q3. The dashboard has no test infrastructure at all
No test script, no vitest config, 0% coverage, and the invite/join UI lives there (`components/invite-member.tsx`, `app/api/projects/[id]/invite`). One orphaned file, `src/__tests__/typecheck.test.ts`, shells out with `cwd: '/Users/ryan/projects/tages-worktrees/e2e-t7-typecheck'`, a path that does not exist. It never executes today, but it is dead code that would throw if wired up.

### Q4. The 13 skipped tests are exactly the ones that would prove the goal
All correctly gated, none are failures: `e2e-cloud-sync.test.ts` (6, needs `TAGES_E2E_SUPABASE_URL`), `invite-flow.test.ts` (3 integration + 2 needing a live dashboard), `e2e-tier-enforcement.test.ts` (1). Today's green run made **no live Supabase calls**, so the result is not contingent on the restore, but it also means **persistence and team-invite are unverified**. These 13 are the highest-value tests to run live before calling anything released.

### Q5. Root-level vitest would glob into stale worktrees
No root `vitest.config.ts` exists, and none of the 4 real configs exclude `.claude/worktrees/**` or `.claude/parallel/**`. Per-package runs are directory-scoped so today's run was clean, but `npx vitest list` from the repo root picks up **149 stale test files** across the 5 live worktrees and throws module-resolution errors. Latent, and it will bite whoever runs vitest from the root.

---

## 7. WHAT THIS MEANS FOR "TOMORROW"

Reachable tomorrow, in dependency order: publish → join → wire → write → read, on **plaintext memories**, with the security fixes in front.

Not reachable tomorrow, and should be stated as out of scope rather than quietly dropped:
- **Encrypted cross-user recall** (G3), needs a key-distribution design, not a patch.
- **Harness → recallable memory** (G1), needs a distillation pipeline that does not exist; there is no consumer to fix, only one to build.
- **True `"last night"` temporal querying** (G2), needs vocabulary plus a date-filter surface on both CLI and MCP.

The honest framing for the team: *"memories your teammates deliberately saved"*, not *"everything your agent did last night."* The first is one day of work. The second is a feature.
