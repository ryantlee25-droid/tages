# Tages Onboarding Day, Handoff

_Branch `release/2026-08-13-onboarding`, 26 commits, 33 files, +3,991/-180. Gate green: build 0, typecheck 0, tests 821 server + 405 CLI + 97 other, 0 failures, no test pollution._

---

## READ FIRST, two things changed after this document was written

### 1. The release candidate is `npm-publish-prep`, NOT `release/2026-08-13-onboarding`

An automated end-to-end suite (3 real identities, real CLI, real prod Supabase) found that **`tages link --project-id` crashes on `release/2026-08-13-onboarding`** with `ReferenceError: exports is not defined in ES module scope`. `link.ts` loads the `rootDir`-emitted CJS copy at `dist/packages/shared/src/project-factory.js` instead of the real sibling `dist/`.

This contradicts the earlier assessment that the ESM/CJS defect only affected npm tarballs. It affects the **source-install path too**, which is the one we chose. The join step, the whole point of the release, was dead.

Measured, clean clone, same suite:

| Branch | Result |
|---|---|
| `release/2026-08-13-onboarding` | **9/26** |
| `npm-publish-prep` (tsup bundling) | **28/28** |

Use `npm-publish-prep`. Everywhere this document says `release/2026-08-13-onboarding`, substitute it.

### 2. Embeddings: require NOTHING, but never let the team mix providers

**Corrected from an earlier draft of this document, which said every engineer needs Ollama. They do not.**

Without an embedding provider, nothing breaks. Recall falls back to trigram (pg_trgm literal word overlap) and works. What is lost is semantic matching, so a query phrased differently from the stored memory will miss. `generateEmbedding` returns `null` when neither Ollama nor the opt-in `TAGES_OPENAI_EMBED` path is available; it warns on a throw but not on a missing provider, so the degradation is silent. Confirmed both ways: without Ollama the E2E suite scored 27/28 (only the embedding assertion failing); with Ollama it scored 28/28.

The opt-in gate is deliberate and correct: an automatic OpenAI fallback would make every recall a blocking, billable, up-to-10s network call whenever Ollama was down.

**The constraint that actually matters is uniformity, not presence.** Ollama's `nomic-embed-text` is 768-dim zero-padded to 1536; OpenAI's `text-embedding-3-small` is natively 1536. These are **different vector spaces** and cosine similarity between them is meaningless, not merely degraded. `TAGES_OPENAI_EMBED` gates both the write and read paths precisely to keep the index single-provider (see the header comment in `packages/cli/src/lib/embedding.ts`, which also carries the TODO for the real fix: record `embedding_model` per row).

A team where two engineers run Ollama and one sets `TAGES_OPENAI_EMBED` silently builds an index with two incompatible vector spaces. **That is worse than nobody having embeddings**, because the results look plausible and are noise.

**Also worth knowing before you decide:** all **45** memories currently in the prod `tages` project have no embedding at all. Semantic recall there is already inert, and enabling a provider only affects newly-written memories, not the existing corpus.

**Recommendation for the rollout: require nothing.** Everyone runs with no provider — trigram-only, uniform, zero setup, no mixed-index risk. Standardising on Ollama plus a backfill is a deliberate follow-up, not a rollout dependency.

### 3. Anyone already globally linked must re-link

`npm-publish-prep` moves the `bin` target from `dist/packages/cli/src/index.js` to `dist/index.js`. Any existing `pnpm link --global` dangles after pulling and rebuilding. Re-run `pnpm link --global` from `packages/cli`.

### What the automated suite already proved, so you needn't re-prove it

Owner links and writes; the memory reaches Supabase `status=live` with an embedding; owner invites an admin; the teammate accepts via the zero-arg 0065 RPC; the teammate joins and gets `.mcp.json` + git hook + a **local** server path; **the teammate recalls the owner's memory**; writes back; **the owner recalls theirs**; an outsider is refused the join and gets zero rows from both recall RPCs; `doctor` passes and no longer advises `tages init`; the MCP server boots in ~1.1s and returns the owner's memory **to the teammate's agent**.

Your live run with a second human is still worth doing, because it covers the one leg the suite cannot: **real GitHub OAuth in a browser**. Everything downstream of that is verified.

---

**Everything below in Part 1 is yours. None of it can be delegated.** Do it in this order; the ordering is load-bearing in two places, both called out.

---

## PART 1, your runbook

### Step 1. Un-pause `tages-dev` — DO THIS FIRST
Supabase dashboard, project `ugogdqzhhnuzwgcaovty`, restore from paused.

**Why first:** three security migrations (0065, 0066, 0067) have never been executed by any Postgres. No Docker and no `psql` on this machine, so they are statically verified only. A syntax error would surface for the first time on whatever database receives them. Dev is the only safe place to find out.

### Step 2. Rotate the prod `service_role` key
Supabase dashboard, project `wezagdgpvwfywjoxztfs`, Settings → API, roll `service_role`.

Then delete the `TAGES_SERVICE_KEY` export from `~/.zshrc` (was line 35) and open a fresh shell. I already tightened that file plus `~/.config/tages/auth.json`, `.env.eval`, and `eval/longmemeval/.env` from `644` to `600`, but permissions do not help once a key has been read; only rotation does. Assume the old value is in your Claude Code transcripts.

**ORDERING MATTERS:** remove the export *before* 0066 reaches any database you care about. After 0066, callers using `TAGES_SERVICE_KEY` get **zero rows** from all four recall RPCs, because a service-role JWT has no `sub` claim and a `SECURITY DEFINER` internal check is an ordinary predicate that service_role does not bypass. If the export is still set you will debug an empty `tages recall` that is not a bug.

Rotating also breaks the eval harness, which authenticates by service key. LongMemEval is already cut from this release.

### Step 3. Apply migrations to dev, then verify
```
supabase link --project-ref ugogdqzhhnuzwgcaovty
supabase migration list --linked          # expect 0064
supabase db push                           # applies 0065, 0066, 0067
```
Then run the three verification matrices in Part 3. **Do not skip these.** This repo has previously locked owners out of their own data for 12 hours via a copied RLS helper that dropped an owner branch.

### Step 4. Apply to prod, only after dev passes
```
supabase link --project-ref wezagdgpvwfywjoxztfs
supabase migration list --linked          # expect 0064
supabase db push
```

### Step 4b. Re-authenticate your CLI as the RIGHT identity — E2E BLOCKER

Found while verifying prod. Your CLI is not authenticated as the owner of the `tages` project:

| identity | user id | status |
|---|---|---|
| `ryantlee25@gmail.com` | `eba1647e-3a82-4988-8b45-a39a7086e671` | **owns the `tages` project** (and docgen-cloud, the-remnant) |
| `rlee@mersive.com` | `1ac7a9ba-d7ac-458d-9830-00c6e6f8fb91` | what `~/.config/tages/auth.json` cached, **token expired 2026-07-09** |

That is why `tages status` reports `Memories: 0` against a project holding 45 live memories. **This predates today's migrations** — they changed RPCs and a trigger, never the `memories` table RLS, and the same command returns 0 with or without `TAGES_SERVICE_KEY` set.

Fix before the E2E: re-auth as `ryantlee25@gmail.com`.
```
cd ~/projects/tages
tages link --project-id 6bf970ef-66c5-4e72-805e-df3fe21ed887
# sign in as ryantlee25@gmail.com, NOT rlee@mersive.com
tages status     # Memories: must be non-zero
```
If you would rather run the dogfood from your Mersive identity, transfer project ownership or add `rlee@mersive.com` as an admin member instead. Decide before inviting teammates, since the owner is the only one who can grant admin.

### Step 5. Confirm `NEXT_PUBLIC_APP_URL` in Vercel
The dashboard invite route's `redirectTo` falls back to `https://tages.ai` when this is unset, while every CLI and server constant hardcodes `app.tages.ai`. If it is wrong, the invite email sends your teammate to the wrong host. Also confirm `SUPABASE_SERVICE_ROLE_KEY` is set there, or dashboard invites 500 with no startup warning.

### Step 6. Seats and secrets
Free tier is **you plus 2**. A third engineer is blocked mid-demo with `Seat limit reached for this project plan`. Confirm headcount, upgrade if needed.

Set the four keepalive secrets in GitHub repo settings (`SUPABASE_PROD_URL`, `SUPABASE_PROD_ANON_KEY`, `SUPABASE_DEV_URL`, `SUPABASE_DEV_ANON_KEY`), commit `.github/workflows/supabase-keepalive.yml` (still untracked), and fire it once via `workflow_dispatch`.

### Step 7. Trigger the code review
`/code-review` at high effort against the full branch diff. Only you can invoke it. This is the gate that has repeatedly caught what tests and White both missed.

### Step 8. Run the E2E in Part 2 with a real second person.

---

## PART 2, the live two-identity E2E

Identity **A** = you, project owner. Identity **B** = a Mersive engineer on their own GitHub account and their own machine. A second OS user with a separate `$HOME` is an acceptable stand-in for the machine; the GitHub identity must be genuinely different.

1. **[A]** Get the project UUID. It is now displayed in two places that previously showed nothing: `tages status` (line labelled `ID:`) and the dashboard project settings page.
   **PASS:** a valid UUID.

2. **[A, dashboard]** Settings → Team → invite B's email with **role = Admin**.
   Admin, not the default Member: `is_write_authorized` requires owner or admin, and a Member's writes fail silently. Use the dashboard, not `tages team invite`, which sends no email.
   **PASS:** invite shows pending, B receives a magic-link email.

3. **[B]** Build from source. The published npm packages are stale April builds and the published CLI is structurally broken.
   ```
   git clone https://github.com/ryantlee25-droid/tages.git
   cd tages && git checkout release/2026-08-13-onboarding
   pnpm install --frozen-lockfile && pnpm -r build
   cd packages/cli && pnpm link --global
   ```
   **PASS:** build exits 0; `tages --version` prints `0.3.0`. I verified this exact sequence from a genuinely clean clone.

4. **[B] `cd` into their OWN work repo.** Not the tages clone.
   The clone is a build artifact. `.mcp.json` is written to the current directory, so this is what binds Tages to the repo they actually work in. **Getting this wrong is the most likely way the demo "passes" while delivering nothing usable.**

5. **[B]** `tages link --project-id <UUID>`
   **PASS:** GitHub OAuth opens (B authenticates as B); prints `Joined project`; `.mcp.json` written **in the work repo**; the `MCP server:` line says **`(local build)`**, not `(published package)`.
   **FAIL:** `Could not find project ... for your account` means the invite did not land or B used a different GitHub email.

6. **[B]** `tages doctor`
   **PASS:** `MCP server config — Claude Code project scope`. Before today this check probed only Claude Desktop paths and would have failed here, then advised running `tages init`, which would have wedged them.

7. **[B]** Open Claude Code in the work repo, run `/mcp`.
   **PASS:** `tages` listed and connected.

8. **[A]** Write a memory:
   `tages remember "onboarding-e2e-$(date +%s)" "E2E memory written by A at $(date)" --type entity`
   **PASS:** green `Stored:`. If you see yellow `Stored locally only: / Cloud sync failed:`, **stop** — B will never see it. That warning did not exist before today; the CLI printed green unconditionally.

9. **[A]** Prove it actually reached Supabase. Do not trust the CLI alone.
   ```
   curl -s "https://wezagdgpvwfywjoxztfs.supabase.co/rest/v1/memories?project_id=eq.<UUID>&key=eq.<key>&select=id,status,embedding" \
     -H "apikey: <anon key>" -H "Authorization: Bearer <A's access token>"
   ```
   **PASS:** one row, `status: "live"`, `embedding` non-null.
   `status: "pending"` means it is invisible to recall. `embedding: null` means B gets trigram-only matching.
   Use A's session token, **not** the service-role key: after 0066 the service key returns nothing, and you should not be exporting it anyway.

10. **[B]** Restart Claude Code. **Required, not optional.** There is no periodic pull; sync is push-only and hydration runs only at MCP startup. Then recall:
    `tages recall "<distinctive words from A's memory>"`
    **PASS:** A's memory appears with readable text.
    If empty: check step 9 passed (data problem vs recall problem), confirm the restart, and delete `~/.config/tages/cache/<slug>.db` and retry once.

11. **[B]** Write as B: `tages remember "onboarding-e2e-b-$(date +%s)" "E2E memory written by B" --type entity`
    **PASS:** green `Stored:`. This also proves B's admin role grants write. A `permission denied` here means step 2 invited them as Member.

12. **[A]** Restart, then `tages recall "E2E memory written by B"`.
    **PASS:** you see B's memory. Loop closed, bidirectionally.

---

## PART 3, migration verification matrices

Run each as the **real role**, not as `postgres` or `service_role`, or every case passes vacuously.

### 0066, recall RLS guards, 12 cells
Capture a baseline as OWNER **before** applying, saving full ordered results including similarity values, for all four of `recall_memories`, `semantic_recall`, `hybrid_recall`, `chunk_semantic_recall`.

- **(a) owner:** identical to baseline, same rows, same similarities, same order. Any drift means the guard leaked into the query body. Reject.
- **(b) active member:** identical to (a). A member pass with an owner fail, or the reverse, means an OR-branch was dropped. This is the 12-hour-lockout regression.
- **(c) authenticated non-member:** zero rows for a project UUID that returned data in (a). Run this **before** applying too, to confirm the leak reproduces; that delta is the vulnerability.
- **(c') pending and revoked members:** also zero rows.

### 0065, accept_pending_invites
- Authenticated user with a matching pending invite: flips to `active`, returns 1.
- Same user calling again: returns 0, harmless no-op.
- User with **no** matching pending row: returns 0, and critically does **not** claim anyone else's.
- Verify the old 2-arg signature is gone: `select accept_pending_invites('x@y.com', '<uuid>')` must error.

### 0067, invite role guard, 9 cells
owner→admin allow · owner→member allow · admin→member allow · **admin→admin deny** (tightened to match the dashboard) · **admin→owner deny** (the defect) · admin updates member row to owner deny · `accept_pending_invites` still flips pending→active for both a `member` and an `admin` pending row (allow, this is the regression that breaks if the guard keys on role value instead of role change) · dashboard invite as owner with `role:'admin'` allow (service-role path, the lockout risk) · seat limit still fires.

---

## PART 4, tell your team these limitations

Say these up front. Each one otherwise reads as "the product is broken."

1. **To see a teammate's new memory, restart Claude Code.** No periodic pull exists. There is no `tages pull`.
2. **This is memories you deliberately save, not everything your agent did.** The harness writes to `harness_tool_events`, which has zero consumers and never becomes recallable.
3. **"last night" does not work as a query.** Only `yesterday` is a recognized temporal keyword, and no date filter is exposed on CLI or MCP. The temporal channel reorders, it never filters.
4. **Never run `tages init` to join.** Use `tages link --project-id`. Slugs are globally unique, so `init` against an existing project fails with a misleading billing error or silently drops you into local-only mode.
5. **Do not set `TAGES_ENCRYPTION_KEY`.** There is no key distribution. If two people set different keys, recall returns error placeholders as memory values.
6. **Run commands from your work repo root**, not a subdirectory. Slug resolution does not walk up and falls back to the first project alphabetically.

---

## PART 5, deferred, with reasons

| Item | Why |
|---|---|
| Public npm publish | Not today's gate. Needs the 2FA token fixed, and the CLI's `rootDir` ESM/CJS defect fixed properly with a bundler first, since it breaks any standalone tarball. The source-install path sidesteps it entirely. |
| Encrypted cross-user recall | No key distribution exists. Needs a design, not a patch. The cheap defensive slice shipped: one bad row no longer kills the whole recall response. |
| Harness → recallable memory | `harness_tool_events` has no consumer. Nothing to fix, a pipeline to build. |
| True temporal filtering | Needs a date-filter surface on both CLI and MCP. Neither exists. |
| `observe` promote-by-wrong-id | `observe.ts:120` updates the remote by local id, which never matches, so promotions stay `pending`. Real bug. The E2E uses `remember`, which is unaffected. |
| SIGTERM handling | Only SIGINT is handled; MCP clients typically SIGTERM. Loses fire-and-forget embeddings on shutdown. |
| Lint | Has never run. Root has no `eslint` dependency; the dashboard's eslint crashes on a plugin version conflict. |
| `invite-flow.test.ts` 2-arg calls | Integration-gated and skipped. Fixing them means re-plumbing onto a per-user JWT client, since they use a service-role client that has no `auth.uid()`. Test-design work, not a signature update. |
| Harness 90-day retention | Promised in the consent prompt and PRIVACY.md, enforced by nothing. |
| `doctor` local-only false green | Reports `PASS — local-only mode` for exactly the state a mis-run `init` leaves behind. Needs a WARN tier. |

---

## Note on two files

`FINDINGS-RELEASE-AUDIT.md` and `PLAN-RELEASE-TOMORROW.md` are deliberately **uncommitted**. This repo is public and both describe the vulnerabilities in detail. Commit them once 0065, 0066, and 0067 are live on prod. The plan is genuinely useful to the team after that.
