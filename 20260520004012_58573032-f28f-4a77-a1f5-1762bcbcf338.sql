
CREATE OR REPLACE FUNCTION public.normalize_code(code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(coalesce(code, ''), '[^a-zA-Z0-9]', '', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.find_count_item_by_code(p_cycle_id uuid, p_code text)
RETURNS SETOF public.count_items
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  n text := public.normalize_code(p_code);
  alias_sku text;
BEGIN
  IF n = '' THEN RETURN; END IF;

  RETURN QUERY
    SELECT * FROM public.count_items
    WHERE cycle_id = p_cycle_id
      AND (public.normalize_code(sku) = n OR public.normalize_code(barcode) = n)
    LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  SELECT sku INTO alias_sku
    FROM public.barcode_aliases
    WHERE public.normalize_code(barcode) = n
    LIMIT 1;

  IF alias_sku IS NOT NULL THEN
    RETURN QUERY
      SELECT * FROM public.count_items
      WHERE cycle_id = p_cycle_id
        AND public.normalize_code(sku) = public.normalize_code(alias_sku)
      LIMIT 1;
  END IF;
END;
$$;
