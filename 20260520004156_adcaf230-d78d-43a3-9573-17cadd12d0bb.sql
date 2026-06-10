
ALTER TABLE public.count_items ADD COLUMN IF NOT EXISTS unit_cost numeric;
ALTER TABLE public.count_items ADD COLUMN IF NOT EXISTS location2 text;
ALTER TABLE public.sku_master ADD COLUMN IF NOT EXISTS location2 text;

CREATE OR REPLACE FUNCTION public.delete_cycle(_cycle_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status cycle_status;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can delete cycles';
  END IF;

  SELECT status INTO v_status FROM public.cycle_counts WHERE id = _cycle_id;
  IF v_status = 'finalized'::cycle_status THEN
    RAISE EXCEPTION 'Cannot delete a finalized cycle';
  END IF;

  DELETE FROM public.count_events WHERE cycle_id = _cycle_id;
  DELETE FROM public.cycle_active_counter WHERE cycle_id = _cycle_id;
  DELETE FROM public.cycle_assignments WHERE cycle_id = _cycle_id;
  DELETE FROM public.count_items WHERE cycle_id = _cycle_id;
  DELETE FROM public.cycle_counts WHERE id = _cycle_id;
END;
$function$;
