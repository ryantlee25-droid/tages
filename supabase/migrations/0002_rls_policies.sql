-- ============================================================
-- Tages — Row Level Security Policies
-- Users can only access their own projects/data.
-- Free tier limits: 1 project, 500 memories.
-- ============================================================

-- Enable RLS on all tables
alter table projects enable row level security;
alter table memories enable row level security;
alter table decision_log enable row level security;
alter table architecture_snapshots enable row level security;
alter table team_members enable row level security;
alter table user_profiles enable row level security;

-- -----------------------------------------------------------
-- Helper: check if user is Pro
-- -----------------------------------------------------------
create or replace function is_pro(uid uuid)
returns boolean as $$
  select coalesce(
    (select is_pro from user_profiles where user_id = uid),
    false
  );
$$ language sql security definer stable;

-- -----------------------------------------------------------
-- Helper: check if user is a member of a project
-- -----------------------------------------------------------
create or replace function is_project_member(uid uuid, pid uuid)
returns boolean as $$
  select exists(
    select 1 from team_members
    where user_id = uid and project_id = pid
  ) or exists(
    select 1 from projects
    where id = pid and owner_id = uid
  );
$$ language sql security definer stable;

-- -----------------------------------------------------------
-- projects
-- -----------------------------------------------------------
create policy "Users can read own projects"
  on projects for select
  using (owner_id = auth.uid() or is_project_member(auth.uid(), id));

create policy "Users can insert projects (free: max 1)"
  on projects for insert
  with check (
    owner_id = auth.uid()
    and (
      is_pro(auth.uid())
      or (select count(*) from projects where owner_id = auth.uid()) < 1
    )
  );

create policy "Owners can update own projects"
  on projects for update
  using (owner_id = auth.uid());

create policy "Owners can delete own projects"
  on projects for delete
  using (owner_id = auth.uid());

-- -----------------------------------------------------------
-- memories
-- -----------------------------------------------------------
create policy "Members can read project memories"
  on memories for select
  using (is_project_member(auth.uid(), project_id));

create policy "Members can insert memories (free: max 500)"
  on memories for insert
  with check (
    is_project_member(auth.uid(), project_id)
    and (
      is_pro(auth.uid())
      or (select count(*) from memories m where m.project_id = memories.project_id) < 500
    )
  );

create policy "Members can update project memories"
  on memories for update
  using (is_project_member(auth.uid(), project_id));

create policy "Members can delete project memories"
  on memories for delete
  using (is_project_member(auth.uid(), project_id));

-- -----------------------------------------------------------
-- decision_log
-- -----------------------------------------------------------
create policy "Members can read decision log"
  on decision_log for select
  using (is_project_member(auth.uid(), project_id));

create policy "Members can insert decision log"
  on decision_log for insert
  with check (is_project_member(auth.uid(), project_id));

create policy "Members can delete decision log entries"
  on decision_log for delete
  using (is_project_member(auth.uid(), project_id));

-- -----------------------------------------------------------
-- architecture_snapshots
-- -----------------------------------------------------------
create policy "Members can read architecture snapshots"
  on architecture_snapshots for select
  using (is_project_member(auth.uid(), project_id));

create policy "Members can insert architecture snapshots"
  on architecture_snapshots for insert
  with check (is_project_member(auth.uid(), project_id));

-- -----------------------------------------------------------
-- team_members
-- -----------------------------------------------------------
create policy "Members can see team"
  on team_members for select
  using (is_project_member(auth.uid(), project_id));

create policy "Owners can manage team"
  on team_members for insert
  with check (
    exists(
      select 1 from projects
      where id = project_id and owner_id = auth.uid()
    )
  );

create policy "Owners can remove team members"
  on team_members for delete
  using (
    exists(
      select 1 from projects
      where id = project_id and owner_id = auth.uid()
    )
  );

-- -----------------------------------------------------------
-- user_profiles
-- -----------------------------------------------------------
create policy "Users can read own profile"
  on user_profiles for select
  using (user_id = auth.uid());

create policy "Users can insert own profile"
  on user_profiles for insert
  with check (user_id = auth.uid());

create policy "Users can update own profile"
  on user_profiles for update
  using (user_id = auth.uid());
