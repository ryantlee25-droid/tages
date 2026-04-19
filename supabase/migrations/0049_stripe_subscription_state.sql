-- ============================================================
-- Tages — Stripe subscription state columns + seat limit RPC
-- Tracks subscription_id, seat count, and subscription status
-- on user_profiles. Adds plan propagation to projects.
-- ============================================================

-- 1. New columns on user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_quantity INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT NULL;

-- 2. Add plan column to projects (mirrors user_profiles.plan for MCP tier gate)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'team'));

-- Backfill: set projects.plan from owner's user_profiles.plan
UPDATE projects p
SET plan = up.plan
FROM user_profiles up
WHERE p.owner_id = up.user_id
  AND up.plan <> 'free';

-- 3. seat_limit_for_project(pid uuid) → INT
--    Returns the seat limit for a given project based on the owner's plan:
--      team  → subscription_quantity (from user_profiles), capped at 20
--      pro   → 5 (fixed)
--      free  → 2 (default)
CREATE OR REPLACE FUNCTION seat_limit_for_project(pid uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    CASE up.plan
      WHEN 'team' THEN
        LEAST(
          COALESCE(
            (SELECT subscription_quantity
             FROM user_profiles
             WHERE user_id = (SELECT owner_id FROM projects WHERE id = pid)),
            1
          ),
          20
        )
      WHEN 'pro' THEN 5
      ELSE 2
    END
  FROM user_profiles up
  WHERE up.user_id = (SELECT owner_id FROM projects WHERE id = pid);
$$;
