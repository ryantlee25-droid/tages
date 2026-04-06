-- Clean up orphaned memory_versions from the id-swap bug
-- When memories.id was overwritten on upsert conflict, version rows
-- that referenced the old id became orphaned (FK violated).
DELETE FROM memory_versions
WHERE memory_id NOT IN (SELECT id FROM memories);
