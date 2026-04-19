-- Migration 0050: Re-apply stripe_customer_id column
-- Original migration 0018b was skipped by the Supabase CLI migration runner
-- because of the letter suffix — fresh projects need this column explicitly.
-- Idempotent: safe to apply on environments that already have the column.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_user_profiles_stripe_customer
  ON user_profiles(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
