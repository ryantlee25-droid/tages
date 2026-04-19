-- Migration 0043: Add plan column to projects for tier enforcement
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'pro', 'team'));
