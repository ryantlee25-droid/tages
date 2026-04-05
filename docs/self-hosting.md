# Self-Hosting Guide

Run Tages entirely on your own infrastructure with a self-managed Supabase instance.

## Prerequisites

- Docker (for local Supabase) or a Supabase cloud project
- Node.js 20+

## 1. Set up Supabase

### Option A: Local Supabase (Docker)

```bash
cd tages
supabase start
```

This starts Postgres, Auth, Realtime, and Studio locally. Note the `API URL` and `anon key` from the output.

### Option B: Supabase Cloud

1. Create a project at [supabase.com](https://supabase.com)
2. Note your project URL and anon key from Settings > API

## 2. Run migrations

```bash
# Local
supabase db reset

# Remote
supabase db push --linked
```

This creates the 5 tables: `projects`, `memories`, `decision_log`, `architecture_snapshots`, `team_members`, plus `user_profiles` and `api_tokens`.

## 3. Configure GitHub OAuth

In the Supabase dashboard, go to Authentication > Providers > GitHub:

1. Create a GitHub OAuth App at [github.com/settings/developers](https://github.com/settings/developers)
2. Set the callback URL to `<your-supabase-url>/auth/v1/callback`
3. Enter the Client ID and Client Secret in Supabase

## 4. Set environment variables

For the CLI / MCP server:
```bash
export TAGES_SUPABASE_URL="http://127.0.0.1:54321"  # or your cloud URL
export TAGES_SUPABASE_ANON_KEY="your-anon-key"
export TAGES_PROJECT_ID="your-project-uuid"
```

For the dashboard (`apps/dashboard/.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 5. Initialize

```bash
tages init --local
```

Or with cloud sync:
```bash
tages init
```

## 6. Run the dashboard (optional)

```bash
cd apps/dashboard
pnpm dev
```

Open http://localhost:3000.

## Limits

Self-hosted Tages has no usage limits. The free-tier limits (1 project, 500 memories) are enforced via RLS policies that check the `user_profiles.is_pro` flag. To bypass:

```sql
-- Make yourself Pro
insert into user_profiles (user_id, is_pro) values ('<your-user-id>', true);
```

Or remove the RLS limits entirely in `supabase/migrations/0002_rls_policies.sql`.
