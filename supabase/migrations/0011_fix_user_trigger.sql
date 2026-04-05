-- ============================================================
-- Fix: handle_new_user trigger needs SECURITY DEFINER and
-- explicit search_path to write to public.user_profiles
-- from auth schema context
-- ============================================================

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, is_pro)
  values (new.id, false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
