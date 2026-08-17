-- ============================================================
-- Tages — 0070: record how well established a memory is
--
-- WHY
--   A memory carries three fields that circle "how much should I trust this"
--   and none that answers it:
--
--     type        what the memory is about   (convention, lesson, …)
--     source      how it was captured        (manual, auto_index, agent)
--     confidence  a float
--
--   `confidence = 0.8` is uninterpretable: 0.8 because a test proved the claim,
--   or because a model guessed it? Those warrant opposite behaviour from a
--   reader — act on it, or check it first — and nothing in the schema
--   distinguishes them. Agents therefore treat a plausible inference and a
--   verified fact identically, which is how a confident-sounding memory store
--   quietly becomes a misleading one.
--
--   Adapted from YAIML's evidence discipline (github.com/wirsingj/YAIML).
--
-- NAMING
--   `evidence`, not `status`: memories.status is already live/pending/archived.
--
-- NULL IS MEANINGFUL
--   Nullable with NO default and NO backfill. Every row written before this
--   migration has no assessment behind it, and stamping one on would be
--   inventing evidence — the exact failure this column exists to prevent.
--   NULL reads as "unknown", and retrieval treats it neutrally.
--
-- INDEX
--   Partial, excluding NULL. Ranking filters and reports group by this column
--   only where it is set, and on an unmigrated corpus almost every row is NULL,
--   so indexing those adds size and no selectivity.
-- ============================================================

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS evidence text;

-- Constraint rather than an enum type: adding a value to a Postgres enum
-- cannot run inside a transaction with other DDL in older versions, and this
-- set is expected to grow. A CHECK is trivially alterable.
ALTER TABLE memories
  DROP CONSTRAINT IF EXISTS memories_evidence_check;

ALTER TABLE memories
  ADD CONSTRAINT memories_evidence_check
  CHECK (evidence IS NULL OR evidence IN ('verified', 'declared', 'observed', 'inferred', 'disputed'));

CREATE INDEX IF NOT EXISTS memories_evidence
  ON memories (project_id, evidence)
  WHERE evidence IS NOT NULL;

COMMENT ON COLUMN memories.evidence IS
  'How well established the claim is: verified (checked against something executable), '
  'declared (asserted by a human as policy), observed (seen once), inferred (reasoned, '
  'not checked), disputed (contradicted). NULL means unknown and is never inferred.';

-- Version snapshots carry the level too, so that reverting a memory restores
-- the evidence that applied to that revision rather than the current one.
ALTER TABLE memory_versions
  ADD COLUMN IF NOT EXISTS evidence text;

-- The snapshot trigger is recreated to carry the new column. Everything else is
-- verbatim from 0069 — including SECURITY DEFINER and the pinned search_path,
-- without which the insert is denied by RLS and takes the whole UPDATE with it.
CREATE OR REPLACE FUNCTION snapshot_memory_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF OLD.value IS DISTINCT FROM NEW.value THEN
    INSERT INTO memory_versions (
      memory_id, project_id, key, value, type, source, confidence,
      version, changed_by, changed_by_user_id, change_reason, evidence
    )
    VALUES (
      OLD.id, OLD.project_id, OLD.key, OLD.value, OLD.type, OLD.source, OLD.confidence,
      COALESCE((SELECT MAX(version) FROM memory_versions WHERE memory_id = OLD.id), 0) + 1,
      NEW.source,
      auth.uid(),
      'update',
      OLD.evidence
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS memory_version_snapshot ON memories;
CREATE TRIGGER memory_version_snapshot
  BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION snapshot_memory_version();
