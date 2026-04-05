-- ============================================================
-- Tages — Token Expiration Support
-- Adds optional expires_at column to api_tokens.
-- NULL means non-expiring (backward compatible).
-- ============================================================

ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
