-- ============================================================
-- Tages — Memory Versions RPC supplement
-- Adds get_memory_versions and revert_memory_version RPCs.
-- The memory_versions table + snapshot trigger already exist (0006).
-- ============================================================

-- RPC: get version history by key + project
create or replace function get_memory_versions(
  p_project_id uuid,
  p_key text
)
returns table (
  id uuid,
  memory_id uuid,
  version int,
  value text,
  confidence real,
  changed_by text,
  change_reason text,
  created_at timestamptz
) as $$
  select
    mv.id,
    mv.memory_id,
    mv.version,
    mv.value,
    mv.confidence,
    mv.changed_by,
    mv.change_reason,
    mv.created_at
  from memory_versions mv
  where mv.project_id = p_project_id
    and mv.key = p_key
  order by mv.version desc;
$$ language sql security definer stable;

-- RPC: revert a memory to a specific version value
create or replace function revert_memory_to_version(
  p_project_id uuid,
  p_key text,
  p_version int
)
returns void as $$
declare
  v_value text;
  v_confidence real;
begin
  select value, confidence
  into v_value, v_confidence
  from memory_versions
  where project_id = p_project_id
    and key = p_key
    and version = p_version;

  if not found then
    raise exception 'Version % not found for key %', p_version, p_key;
  end if;

  update memories
  set value = v_value,
      confidence = v_confidence,
      updated_at = now()
  where project_id = p_project_id
    and key = p_key;
end;
$$ language plpgsql security definer;
