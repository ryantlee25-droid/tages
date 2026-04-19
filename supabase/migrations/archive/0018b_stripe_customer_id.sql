-- ARCHIVED — DO NOT APPLY
--
-- This migration was originally applied to production directly via the Supabase SQL editor
-- on 2026-04-09, before the Supabase CLI migration workflow was fully adopted.
--
-- The letter-suffix "0018b" causes `supabase db push` to emit a warning on every push
-- because Supabase CLI expects strictly numeric migration filenames.
--
-- The column this migration adds (stripe_customer_id on user_profiles) is already present
-- in production. It is also idempotently re-applied by:
--   supabase/migrations/0050_ensure_stripe_customer_id.sql  (IF NOT EXISTS guard)
--
-- This file has been moved to supabase/migrations/archive/ so the CLI stops warning.
-- Do NOT rename it with a numeric prefix — Supabase would attempt to apply it again,
-- causing a conflict on databases where the column already exists.

-- Add stripe_customer_id to user_profiles for secure subscription lookup
-- Previously looked up by email which could allow account takeover on email reuse

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_user_profiles_stripe_customer
  ON user_profiles(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
