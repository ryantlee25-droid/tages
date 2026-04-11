-- Migration 0044: Add invite lifecycle columns to team_members
-- Enables pending invites by email before user signs up

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'revoked')),
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS invited_at timestamptz DEFAULT now();

-- Allow null user_id for pending invites (user hasn't signed up yet)
ALTER TABLE team_members ALTER COLUMN user_id DROP NOT NULL;

-- Prevent duplicate pending invites for the same email in a project
CREATE UNIQUE INDEX IF NOT EXISTS team_members_pending_email
  ON team_members(project_id, email)
  WHERE status = 'pending';
