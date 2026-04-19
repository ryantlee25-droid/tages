# Dev Environment Teardown

Manual steps to fully remove the dev/staging environment when no longer needed.
**Do not execute these without deliberate confirmation — all actions are irreversible.**

---

## 1. Delete Supabase Dev Project

Project reference: `ugogdqzhhnuzwgcaovty` (tages-dev)

1. Open [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Select the **tages-dev** project
3. Go to **Settings → General**
4. Scroll to the bottom and click **Delete project**
5. Confirm by typing the project name

---

## 2. Delete GitHub OAuth App "Tages (Dev)"

1. Open [https://github.com/settings/developers](https://github.com/settings/developers)
2. Click **OAuth Apps**
3. Find the app named **Tages (Dev)**
4. Click **Delete** and confirm

This prevents orphaned OAuth callbacks from succeeding against a deleted Supabase project.

---

## 3. Remove Vercel Preview Environment Variables

The following 3 environment variables in the Vercel dashboard point at the dev Supabase project and should be removed from the **Preview** environment (not Production):

| Variable | Value points to |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ugogdqzhhnuzwgcaovty.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dev project anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Dev project service role key |

Steps:
1. Open [https://vercel.com/dashboard](https://vercel.com/dashboard) → select the **tages** project
2. Go to **Settings → Environment Variables**
3. Filter to **Preview** environment
4. Delete or unset each of the three variables listed above
5. Trigger a new Preview deployment to confirm it uses Production values (or configure separate staging env vars)

---

## After Teardown

- Preview deploys will fall back to Production Supabase unless new Preview-specific env vars are configured
- Any CLI tokens issued against the dev Supabase project will stop working immediately after project deletion
- GitHub OAuth logins via the dev OAuth app will return a 404 from Supabase after project deletion
