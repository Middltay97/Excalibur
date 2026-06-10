CREATE OR REPLACE FUNCTION public.refresh_open_cycle_expected_qty()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can refresh expected quantities';
  END IF;

  WITH upd AS (
    UPDATE public.count_items ci
       SET expected_qty = COALESCE(sm.on_hand_qty, 0),
           updated_at = now()
      FROM public.cycle_counts cc,
           public.sku_master sm
     WHERE ci.cycle_id = cc.id
       AND cc.status <> 'finalized'::cycle_status
       AND ci.is_unexpected = false
       AND sm.master_key = public.normalize_code(ci.sku)
       AND COALESCE(ci.expected_qty, 0) IS DISTINCT FROM COALESCE(sm.on_hand_qty, 0)
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM upd;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_open_cycle_expected_qty() TO authenticated;