-- Migration 0046: Seat limit enforcement per project plan
-- Free: 2 seats | Pro: 5 seats | Team: 25 seats
-- Only counts active members (pending invites don't consume seats)

CREATE OR REPLACE FUNCTION seat_limit_for_project(pid uuid)
RETURNS integer AS $$
  SELECT CASE
    WHEN p.plan = 'team' THEN 25
    WHEN p.plan = 'pro'  THEN 5
    ELSE 2
  END
  FROM projects p WHERE p.id = pid;
$$ LANGUAGE sql STABLE SECURITY DEFINER
   SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION check_seat_limit()
RETURNS trigger AS $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM team_members
    WHERE project_id = NEW.project_id AND status = 'active'
  ) >= seat_limit_for_project(NEW.project_id) THEN
    RAISE EXCEPTION 'Seat limit reached for this project plan';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, extensions;

DROP TRIGGER IF EXISTS enforce_seat_limit ON team_members;

CREATE TRIGGER enforce_seat_limit
  BEFORE INSERT ON team_members
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION check_seat_limit();
