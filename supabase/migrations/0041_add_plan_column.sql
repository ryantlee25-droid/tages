-- Add plan column to user_profiles for tier tracking (free/pro/team)
alter table user_profiles add column if not exists plan text not null default 'free'
  check (plan in ('free', 'pro', 'team'));

-- Backfill: existing pro users get 'pro' plan
update user_profiles set plan = 'pro' where is_pro = true and plan = 'free';
