-- ============================================================
-- Tages — Auth Audit Log
-- Tracks login successes, failures, and token validation events
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,
  event_type  TEXT NOT NULL CHECK (event_type IN ('login_success', 'login_failed', 'token_invalid', 'token_expired')),
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_audit_user  ON auth_audit_log(user_id, created_at DESC);
CREATE INDEX idx_auth_audit_event ON auth_audit_log(event_type, created_at DESC);

-- RLS: only service role can insert, users can read their own
ALTER TABLE auth_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own audit log"
  ON auth_audit_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow insert of audit events"
  ON auth_audit_log FOR INSERT
  WITH CHECK (true);
