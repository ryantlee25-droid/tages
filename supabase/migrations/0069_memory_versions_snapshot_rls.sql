-- ============================================================
-- Tages — 0069: let the version-snapshot trigger actually insert
--
-- FOUND BY: e2e/ phase 03, 2026-08-17, against prod.
--
-- Independent of 0068_recall_service_role_bypass, which fixes a different
-- recall regression. This one is about the UPDATE path, not the read path.
--
-- SYMPTOM
--   The first time any user edits any memory, the CLI prints:
--     [tages] Sync flush failed: new row violates row-level security
--     policy for table "memory_versions"
--   The edit never reaches Supabase. Worse, the failed row stays dirty in the
--   local sync queue, so EVERY subsequent flush retries it, hits the same
--   error, and aborts — taking brand-new, unrelated memories down with it.
--   From that point on nothing that developer writes reaches their team.
--   Exit code stays 0 and stdout stays empty; the warning goes to stderr.
--
-- CAUSE
--   0006 created memory_versions with RLS enabled and exactly one policy:
--     create policy "Members can read version history"
--       on memory_versions for select ...
--   There has never been an INSERT policy, in any of the 67 migrations. The
--   snapshot trigger that populates the table:
--     create or replace function snapshot_memory_version()
--     returns trigger as $$ ... $$ language plpgsql;      -- no SECURITY DEFINER
--   runs as the invoking user, so its INSERT is evaluated against RLS and
--   denied. A BEFORE UPDATE trigger that raises takes the whole UPDATE with it.
--
--   It went unnoticed because the update path had no end-to-end coverage: unit
--   tests mock Supabase, and the previous manual harness only ever created
--   memories, never corrected one.
--
-- FIX
--   Make the trigger function SECURITY DEFINER, pinned to a fixed search_path,
--   so the audit insert runs with the table owner's rights — the same pattern
--   0051 already uses for check_seat_limit_on_update, and the standard shape
--   for an append-only audit trigger.
--
--   SECURITY DEFINER is safe here specifically because the function takes no
--   caller-supplied arguments: every value it writes comes from OLD/NEW of a
--   row the caller had to be authorized to UPDATE in the first place. It
--   cannot be aimed at another project's rows.
--
--   The SELECT policy is left exactly as it is: reads stay restricted to
--   active project members. No INSERT policy is added, so nothing other than
--   this trigger can write history.
-- ============================================================

CREATE OR REPLACE FUNCTION snapshot_memory_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Only snapshot when the value actually changed, unchanged from 0006.
  IF OLD.value IS DISTINCT FROM NEW.value THEN
    INSERT INTO memory_versions (
      memory_id, project_id, key, value, type, source, confidence,
      version, changed_by, changed_by_user_id, change_reason
    )
    VALUES (
      OLD.id, OLD.project_id, OLD.key, OLD.value, OLD.type, OLD.source, OLD.confidence,
      COALESCE((SELECT MAX(version) FROM memory_versions WHERE memory_id = OLD.id), 0) + 1,
      NEW.source,
      -- 0048 added changed_by_user_id and nothing has ever populated it.
      -- Filling it here gives version history real attribution.
      --
      -- This does NOT fix get_memory_authors, which reads memories.updated_by
      -- — a column no write path sets (memoryToDbRow in
      -- packages/server/src/sync/supabase-sync.ts:693 omits both created_by
      -- and updated_by entirely). That is a separate defect in the sync layer,
      -- not something a migration can repair.
      --
      -- auth.uid() is NULL for a service-role caller, which correctly records
      -- "not a user action" rather than mis-attributing it.
      auth.uid(),
      'update'
    );
  END IF;
  RETURN NEW;
END;
$$;

-- The trigger definition itself is unchanged; recreate only to be explicit
-- about what is attached, since CREATE OR REPLACE FUNCTION does not touch it.
DROP TRIGGER IF EXISTS memory_version_snapshot ON memories;
CREATE TRIGGER memory_version_snapshot
  BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION snapshot_memory_version();
