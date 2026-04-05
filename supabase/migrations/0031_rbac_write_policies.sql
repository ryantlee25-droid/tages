-- ============================================================
-- Tages — Granular RBAC: Restrict writes to owner/admin roles
-- Affects: memories, decision_log, architecture_snapshots
-- SELECT policies are untouched.
-- team_members and projects policies are untouched.
-- ============================================================

-- -----------------------------------------------------------
-- Helper: check if user is authorized to write to a project
-- Returns true if:
--   - user is the project owner (projects.owner_id = uid), OR
--   - user has role 'owner' or 'admin' in team_members for that project
-- -----------------------------------------------------------
create or replace function is_write_authorized(uid uuid, pid uuid)
returns boolean as $$
  select exists(
    select 1 from projects
    where id = pid and owner_id = uid
  ) or exists(
    select 1 from team_members
    where user_id = uid
      and project_id = pid
      and role in ('owner', 'admin')
  );
$$ language sql security definer;

-- -----------------------------------------------------------
-- memories — drop existing write policies, recreate with RBAC
-- -----------------------------------------------------------
drop policy if exists "Members can insert memories (free: max 500)" on memories;
drop policy if exists "Members can update project memories" on memories;
drop policy if exists "Members can delete project memories" on memories;

create policy "Write-authorized users can insert memories (free: max 500)"
  on memories for insert
  with check (
    is_write_authorized(auth.uid(), project_id)
    and (
      is_pro(auth.uid())
      or (select count(*) from memories m where m.project_id = memories.project_id) < 500
    )
  );

create policy "Write-authorized users can update project memories"
  on memories for update
  using (is_write_authorized(auth.uid(), project_id));

create policy "Write-authorized users can delete project memories"
  on memories for delete
  using (is_write_authorized(auth.uid(), project_id));

-- -----------------------------------------------------------
-- decision_log — drop existing write policies, recreate with RBAC
-- -----------------------------------------------------------
drop policy if exists "Members can insert decision log" on decision_log;
drop policy if exists "Members can delete decision log entries" on decision_log;

create policy "Write-authorized users can insert decision log"
  on decision_log for insert
  with check (is_write_authorized(auth.uid(), project_id));

create policy "Write-authorized users can delete decision log entries"
  on decision_log for delete
  using (is_write_authorized(auth.uid(), project_id));

-- -----------------------------------------------------------
-- architecture_snapshots — drop existing write policy, recreate with RBAC
-- -----------------------------------------------------------
drop policy if exists "Members can insert architecture snapshots" on architecture_snapshots;

create policy "Write-authorized users can insert architecture snapshots"
  on architecture_snapshots for insert
  with check (is_write_authorized(auth.uid(), project_id));
