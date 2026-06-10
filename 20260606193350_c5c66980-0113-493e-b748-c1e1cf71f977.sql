-- Restrict badge_id column on profiles to admins only via SECURITY DEFINER RPC
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, full_name, default_warehouse_id, team_id, created_at, updated_at) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_profiles_with_badges()
RETURNS TABLE(id uuid, full_name text, badge_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can read badge IDs';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.badge_id
    FROM public.profiles p
    ORDER BY p.badge_id NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_profiles_with_badges() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_profiles_with_badges() TO authenticated;