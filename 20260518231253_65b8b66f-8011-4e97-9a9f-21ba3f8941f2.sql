
-- Normalize codes: strip non-alphanumerics, lowercase
CREATE OR REPLACE FUNCTION public.normalize_code(code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(coalesce(code, ''), '[^a-zA-Z0-9]', '', 'g'))
$$;

CREATE INDEX IF NOT EXISTS count_items_norm_sku_idx
  ON public.count_items (cycle_id, public.normalize_code(sku));
CREATE INDEX IF NOT EXISTS count_items_norm_barcode_idx
  ON public.count_items (cycle_id, public.normalize_code(barcode));
CREATE INDEX IF NOT EXISTS barcode_aliases_norm_barcode_idx
  ON public.barcode_aliases (public.normalize_code(barcode));

-- Lookup function: matches by normalized sku or barcode, with alias fallback
CREATE OR REPLACE FUNCTION public.find_count_item_by_code(p_cycle_id uuid, p_code text)
RETURNS SETOF public.count_items
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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

GRANT EXECUTE ON FUNCTION public.find_count_item_by_code(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_code(text) TO anon, authenticated, service_role;
