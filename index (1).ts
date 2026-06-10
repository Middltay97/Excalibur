
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_cycle(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mobile_apply_scan(uuid, uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_profiles_with_badges() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_profile_names() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_profile_names(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_open_cycle_expected_qty() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_cycle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_apply_scan(uuid, uuid, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_profiles_with_badges() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_profile_names() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_names(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_open_cycle_expected_qty() TO authenticated;
