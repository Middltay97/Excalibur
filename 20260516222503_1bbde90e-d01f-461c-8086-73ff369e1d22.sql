
-- Unique index for client_event_id idempotency (per cycle)
CREATE UNIQUE INDEX IF NOT EXISTS count_events_cycle_client_event_uidx
  ON public.count_events (cycle_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

-- Atomic scan: locks row, dedupes by client_event_id, returns new qty
CREATE OR REPLACE FUNCTION public.mobile_apply_scan(
  p_cycle_id uuid,
  p_item_id uuid,
  p_user_id uuid,
  p_add_qty numeric,
  p_client_event_id text,
  p_action text
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_existing_after numeric;
BEGIN
  IF p_client_event_id IS NOT NULL THEN
    SELECT qty_after INTO v_existing_after
    FROM public.count_events
    WHERE cycle_id = p_cycle_id AND client_event_id = p_client_event_id
    LIMIT 1;
    IF FOUND THEN
      RETURN v_existing_after;
    END IF;
  END IF;

  SELECT COALESCE(counted_qty, 0) INTO v_before
  FROM public.count_items
  WHERE id = p_item_id AND cycle_id = p_cycle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found';
  END IF;

  v_after := v_before + p_add_qty;

  UPDATE public.count_items
  SET counted_qty = v_after,
      counted_by = p_user_id,
      counted_at = now(),
      status = 'counted'
  WHERE id = p_item_id;

  INSERT INTO public.count_events (
    client_event_id, cycle_id, item_id, user_id, action,
    qty_before, qty_after, source
  ) VALUES (
    p_client_event_id, p_cycle_id, p_item_id, p_user_id, p_action,
    v_before, v_after, 'mobile'
  );

  RETURN v_after;
END;
$$;

-- Backfill counted_qty from event history so totals match the logged scans
UPDATE public.count_items ci
SET counted_qty = sums.total
FROM (
  SELECT item_id,
         SUM(COALESCE(qty_after, 0) - COALESCE(qty_before, 0)) AS total
  FROM public.count_events
  WHERE item_id IS NOT NULL
  GROUP BY item_id
) sums
WHERE ci.id = sums.item_id
  AND COALESCE(ci.counted_qty, 0) <> sums.total;
