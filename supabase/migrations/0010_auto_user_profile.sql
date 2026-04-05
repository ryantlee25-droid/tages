-- ============================================================
-- Tages — Auto-create user profile on signup
-- Creates a user_profiles row when a new user signs up.
-- Also seeds a default project for demo purposes.
-- ============================================================

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into user_profiles (user_id, is_pro)
  values (new.id, false)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
