# Collaborator Onboarding — Vercel + Supabase

Welcome. This doc gets you oriented on the **deployment side** of Tages: how the dashboard runs on Vercel and how Supabase is wired underneath. No production secrets here — when you're ready, the project owner will hand over keys (or invite you to the Vercel/Supabase orgs so you can pull them yourself).

For the product overview, read `README.md`. For local dev mechanics, read `CONTRIBUTING.md` and `docs/self-hosting.md`.

---

## 1. The shape of the system

```
apps/dashboard/        Next.js 16 app  →  deployed to Vercel
supabase/migrations/   64 SQL migrations  →  applied to Supabase Postgres
packages/server,cli    MCP server + CLI  →  published to npm (no Vercel/Supabase role)
```

Two cloud services to know:

| Service | What it hosts | Org / project |
|---|---|---|
| **Vercel** | The Next.js dashboard at `tages.ai` | Org `team_GZacLA2rVWXllAkXLhsdzBGN`, project `dashboard` (`prj_kxtw72ZSjSFolPmwTJTCu4tAtvDh`) |
| **Supabase** | Postgres (memories, RLS, pgvector), Auth (GitHub OAuth), API | Cloud project — slug shared on invite |

The CLI/MCP server packages talk **directly to Supabase** from the user's machine. They don't go through Vercel.

---

## 2. Vercel side

### What's deployed
- Just `apps/dashboard/` (a workspace inside the pnpm monorepo). Vercel's root directory is set to that folder.
- Build command: `pnpm build` (runs `next build`).
- Framework: Next.js 16 with the App Router. React 19.

### Domains
Production is `tages.ai`. `apps/dashboard/vercel.json` 301-redirects four legacy hosts to it:
- `tagesai.app`, `tagesai.dev`, `tagesai.com`, `www.tages.ai` → `tages.ai`

DNS for those is configured at the registrar; Vercel handles TLS.

### Environment variables (Vercel project settings)
These are set in the Vercel dashboard under **Settings → Environment Variables**, scoped per environment (Production / Preview / Development). The local `.env.example` mirrors the names:

```
NEXT_PUBLIC_SUPABASE_URL=        # https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # public anon key — safe in browser
SUPABASE_SERVICE_ROLE_KEY=       # server-only; bypasses RLS — never expose
STRIPE_SECRET_KEY=               # optional; blank = demo mode auto-Pro
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
```

You don't need values yet. Ask before adding any var that begins with `NEXT_PUBLIC_` — those ship to the browser.

### Getting access
Ask the owner to invite your email to the Vercel team. Once in, run:
```bash
pnpm dlx vercel link        # link your local apps/dashboard to the project
pnpm dlx vercel env pull    # pulls .env.local with current values
```

Don't run `vercel --prod` until you've done a Preview deploy at least once and someone's reviewed it.

---

## 3. Supabase side

### What lives there
- **Postgres**, with 64 migrations in `supabase/migrations/` (everything from base schema to RLS, pgvector, RBAC, Stripe customer ids, SSO, seat limits, two-stage retrieval, harness capture).
- **Auth**: Supabase Auth + GitHub OAuth provider. CLI tokens are SHA-256 hashed in the `api_tokens` table.
- **RLS** is enabled on every table. The dashboard uses the anon key; the service role key is reserved for server routes that legitimately need to bypass RLS (e.g. webhook handlers).

### Running it locally (no cloud needed)
This is the recommended way to get familiar before touching the real cloud project.

```bash
# from repo root
brew install supabase/tap/supabase   # if you don't have it
supabase start                       # boots Postgres, Auth, Studio in Docker
supabase db reset                    # applies all 64 migrations + seed.sql
```

After `supabase start`, you'll see local URLs (these are stable across machines):

| Service | URL |
|---|---|
| API | http://127.0.0.1:54321 |
| DB  | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Studio (web UI) | http://127.0.0.1:54323 |
| Inbucket (mail catcher) | http://127.0.0.1:54324 |

The CLI prints a local `anon key` — drop it into `apps/dashboard/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<printed by supabase start>
SUPABASE_SERVICE_ROLE_KEY=<printed by supabase start>
```

Then `pnpm --filter dashboard dev` and visit http://localhost:3000.

### GitHub OAuth (optional locally)
`supabase/config.toml` declares the GitHub provider but reads `env(GITHUB_CLIENT_ID)` / `env(GITHUB_CLIENT_SECRET)`. For local work you can either:
- Leave it disabled and use email magic-link via Inbucket, or
- Create your own throwaway GitHub OAuth App with callback `http://127.0.0.1:54321/auth/v1/callback`.

You don't need the production OAuth credentials to develop.

### Cloud access
When the owner adds you to the Supabase org, you'll get:
- Read access in the Studio (browse tables, run SELECTs).
- The project ref to run `supabase link --project-ref <ref>` so you can `supabase db push` from your machine.

**Never** apply migrations directly to production until you've:
1. Verified them locally with `supabase db reset`.
2. Had the migration reviewed in a PR.

---

## 4. Migrations workflow

This is the most failure-prone area — read it before writing SQL.

- File names are sequential: `0064_chunk_aware_recall.sql` is the latest. Next one is `0065_*.sql`.
- One migration per logical change. They run in order, top to bottom, and are **immutable** once merged.
- TEXT params for uuid columns must cast: `where id = $1::uuid` (project convention).
- Locally: `supabase db reset` wipes and re-applies everything. Fast feedback loop.
- Remote: `supabase db push --linked` ships unapplied migrations to the linked project.

Don't edit a merged migration. Add a new one that fixes the previous.

---

## 5. Things to read in this order

1. `README.md` — what Tages is.
2. `CLAUDE.md` (root) — architecture and conventions.
3. `docs/self-hosting.md` — same Supabase setup, different framing.
4. `apps/dashboard/src/app/` — Next.js routes; start with `layout.tsx` and `api/`.
5. `supabase/migrations/0001_initial_schema.sql` and `0002_rls_policies.sql` — the foundation everything sits on.

---

## 6. What to ask for when you're ready

When you want to ship something to a preview environment:

1. Vercel team invite (your email).
2. Supabase org invite (your email).
3. Confirmation of which environment your changes target — Preview is fine, Production needs a second pair of eyes.

Until then, local Supabase + `pnpm dev` covers ~95% of dashboard work.
