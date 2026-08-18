-- ============================================================
-- Tages — 0074: created_by is set once, by the database, and never reassigned
--
-- WHY THE CLIENT CANNOT OWN THIS
--   `remoteInsert` upserts with `onConflict: 'project_id,key'`, and a Supabase
--   upsert overwrites every column it is given. So a client editing someone
--   else's memory either sends `created_by: null` (erasing the author) or sends
--   its own id (stealing the authorship). Choosing correctly requires knowing
--   whether the row already exists REMOTELY — and a client cannot know that:
--   the CLI's pull is rate-limited, so a teammate's row may legitimately not be
--   in the local cache yet. Measured: the owner editing a teammate's memory
--   rewrote created_by to the owner, because the owner's cache had not pulled
--   it.
--
--   The database is the only party that knows. So it decides.
--
-- WHAT THIS DOES
--   INSERT: created_by falls back to auth.uid() when the client did not supply
--           one. A service-role caller has no auth.uid(); NULL there is
--           correct and means "not a user action".
--   UPDATE: created_by is pinned to its existing value, whatever the client
--           sent. updated_by is left entirely to the client — that field is
--           SUPPOSED to move to whoever last touched the row.
--
--   Deliberately NOT a CHECK or a revoked column privilege: the write path is
--   an upsert that legitimately supplies the column on insert, so the rule is
--   "immutable after creation", which only a trigger can express.
-- ============================================================

CREATE OR REPLACE FUNCTION pin_memory_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL THEN
      NEW.created_by := auth.uid();
    END IF;
  ELSE
    -- Authorship of an existing row is not the editor's to change.
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS memories_pin_created_by ON memories;
CREATE TRIGGER memories_pin_created_by
  BEFORE INSERT OR UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION pin_memory_created_by();

COMMENT ON COLUMN memories.created_by IS
  'Original author. Set once on insert (falling back to auth.uid()) and pinned '
  'on update by trigger memories_pin_created_by — an editor cannot reassign it. '
  'See updated_by for who last changed the row.';
