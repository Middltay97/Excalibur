CREATE OR REPLACE FUNCTION public.delete_cycle(_cycle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can delete cycles';
  END IF;

  DELETE FROM public.count_events WHERE cycle_id = _cycle_id;
  DELETE FROM public.cycle_active_counter WHERE cycle_id = _cycle_id;
  DELETE FROM public.cycle_assignments WHERE cycle_id = _cycle_id;
  DELETE FROM public.count_items WHERE cycle_id = _cycle_id;
  DELETE FROM public.cycle_counts WHERE id = _cycle_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_cycle(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_cycle(uuid) TO authenticated;