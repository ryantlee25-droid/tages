-- ============================================================
-- Tages — Security Lint Fixes
-- Resolves all 5 errors and 27 warnings from Supabase linter
-- (1 warning — leaked password protection — requires dashboard toggle)
-- ============================================================

-- -----------------------------------------------------------
-- P0: Enable RLS on 3 unprotected tables (5 errors)
-- -----------------------------------------------------------

ALTER TABLE public.field_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_memories ENABLE ROW LEVEL SECURITY;

-- field_changes: read + insert via project membership
-- project_id is TEXT in these tables; cast to uuid for is_project_member()
CREATE POLICY "Members can read field changes"
  ON field_changes FOR SELECT
  USING (is_project_member(auth.uid(), project_id::uuid));

CREATE POLICY "Members can insert field changes"
  ON field_changes FOR INSERT
  WITH CHECK (is_project_member(auth.uid(), project_id::uuid));

-- memory_branches: read + insert + update via project membership
CREATE POLICY "Members can read memory branches"
  ON memory_branches FOR SELECT
  USING (is_project_member(auth.uid(), project_id::uuid));

CREATE POLICY "Members can insert memory branches"
  ON memory_branches FOR INSERT
  WITH CHECK (is_project_member(auth.uid(), project_id::uuid));

CREATE POLICY "Members can update memory branches"
  ON memory_branches FOR UPDATE
  USING (is_project_member(auth.uid(), project_id::uuid));

-- branch_memories: read + insert + update + delete via project membership
CREATE POLICY "Members can read branch memories"
  ON branch_memories FOR SELECT
  USING (is_project_member(auth.uid(), project_id::uuid));

CREATE POLICY "Members can insert branch memories"
  ON branch_memories FOR INSERT
  WITH CHECK (is_project_member(auth.uid(), project_id::uuid));

CREATE POLICY "Members can update branch memories"
  ON branch_memories FOR UPDATE
  USING (is_project_member(auth.uid(), project_id::uuid));

CREATE POLICY "Members can delete branch memories"
  ON branch_memories FOR DELETE
  USING (is_project_member(auth.uid(), project_id::uuid));

-- -----------------------------------------------------------
-- P1: Fix auth_audit_log permissive INSERT policy (1 warning)
-- Replace WITH CHECK (true) with authenticated-only
-- -----------------------------------------------------------

DROP POLICY IF EXISTS "Allow insert of audit events" ON auth_audit_log;

CREATE POLICY "Authenticated users can insert audit events"
  ON auth_audit_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- -----------------------------------------------------------
-- P2: Move extensions out of public schema (2 warnings)
-- -----------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS extensions;

ALTER EXTENSION pg_trgm SET SCHEMA extensions;
ALTER EXTENSION vector SET SCHEMA extensions;

-- -----------------------------------------------------------
-- P3: Fix mutable search_path on all 24 public functions (24 warnings)
-- Uses DO block to batch-alter every function in the public schema
-- -----------------------------------------------------------

DO $$
DECLARE
  func_oid oid;
BEGIN
  FOR func_oid IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = public, extensions',
      func_oid::regprocedure
    );
  END LOOP;
END
$$;
