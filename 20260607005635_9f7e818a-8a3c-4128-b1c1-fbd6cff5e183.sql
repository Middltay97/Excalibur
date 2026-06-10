-- 1) Lock down the broad SELECT on profiles. Replace with safe RPCs.
DROP POLICY IF EXISTS "Authenticated view profiles for names" ON public.profiles;

-- Re-assert column-safe table grants: authenticated may read/write profiles,
-- but a SELECT with badge_id will be blocked at column-level.
REVOKE ALL ON public.profiles FROM authenticated, anon;
GRANT SELECT (id, full_name, team_id, default_warehouse_id, created_at, updated_at)
  ON public.profiles TO authenticated;
GRANT UPDATE (full_name, team_id, default_warehouse_id, updated_at)
  ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- 2) Safe lookup of display names (and team) for any authenticated user.
CREATE OR REPLACE FUNCTION public.get_profile_names(_ids uuid[])
RETURNS TABLE(id uuid, full_name text, team_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.team_id
  FROM public.profiles p
  WHERE p.id = ANY(_ids);
$$;
REVOKE ALL ON FUNCTION public.get_profile_names(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_names(uuid[]) TO authenticated;

-- For the "list all known users" use case (performance dashboard, scoped to
-- authenticated only — no badge_id returned).
CREATE OR REPLACE FUNCTION public.list_profile_names()
RETURNS TABLE(id uuid, full_name text, team_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.team_id FROM public.profiles p;
$$;
REVOKE ALL ON FUNCTION public.list_profile_names() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_profile_names() TO authenticated;

-- 3) Tighten existing SECURITY DEFINER functions so anon cannot execute them.
REVOKE ALL ON FUNCTION public.admin_list_profiles_with_badges() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_profiles_with_badges() TO authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_cycle(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_cycle(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.mobile_apply_scan(uuid, uuid, uuid, numeric, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mobile_apply_scan(uuid, uuid, uuid, numeric, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;