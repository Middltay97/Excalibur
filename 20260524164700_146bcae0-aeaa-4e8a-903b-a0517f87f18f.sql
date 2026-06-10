-- 1. Improved normalize_code: strip trailing decimal artifacts, then non-alphanum, then lowercase.
CREATE OR REPLACE FUNCTION public.normalize_code(code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(coalesce(code, ''), '\.\d+$', ''),
      '[^A-Za-z0-9]',
      '',
      'g'
    )
  );
$$;

-- 2. Generate ordered candidate keys for a scanned code.
-- Order: exact compact form, then 12-char body, then 10-char body.
-- Exact/12-char preferred over 10-char so SKUs like 27060-0S020 and
-- 27060-0S020-84 don't collide.
CREATE OR REPLACE FUNCTION public.sku_candidates(code text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  c text;
  out text[] := ARRAY[]::text[];
BEGIN
  c := public.normalize_code(code);
  IF c IS NULL OR c = '' THEN
    RETURN out;
  END IF;
  out := out || c;
  IF length(c) > 12 THEN
    out := out || substr(c, 1, 12);
  END IF;
  IF length(c) > 10 THEN
    out := out || substr(c, 1, 10);
  END IF;
  RETURN out;
END;
$$;

-- 3. Resolve a scanned code to a cycle item using candidate keys + aliases.
CREATE OR REPLACE FUNCTION public.find_count_item_by_code(p_cycle_id uuid, p_code text)
RETURNS SETOF public.count_items
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  cands text[];
  cand text;
  alias_sku text;
  found public.count_items;
BEGIN
  cands := public.sku_candidates(p_code);
  IF array_length(cands, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Direct cycle item match by candidate order
  FOREACH cand IN ARRAY cands LOOP
    SELECT * INTO found
    FROM public.count_items
    WHERE cycle_id = p_cycle_id
      AND (public.normalize_code(sku) = cand OR public.normalize_code(barcode) = cand)
    ORDER BY is_unexpected ASC, created_at ASC
    LIMIT 1;
    IF found.id IS NOT NULL THEN
      RETURN NEXT found;
      RETURN;
    END IF;
  END LOOP;

  -- Alias resolution
  FOREACH cand IN ARRAY cands LOOP
    SELECT sku INTO alias_sku
    FROM public.barcode_aliases
    WHERE public.normalize_code(barcode) = cand
    LIMIT 1;
    IF alias_sku IS NOT NULL THEN
      SELECT * INTO found
      FROM public.count_items
      WHERE cycle_id = p_cycle_id
        AND public.normalize_code(sku) = public.normalize_code(alias_sku)
      ORDER BY is_unexpected ASC, created_at ASC
      LIMIT 1;
      IF found.id IS NOT NULL THEN
        RETURN NEXT found;
        RETURN;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- 4. Resolve a scanned code to a master SKU using candidate keys.
CREATE OR REPLACE FUNCTION public.find_master_sku_by_code(p_code text)
RETURNS SETOF public.sku_master
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  cands text[];
  cand text;
  found public.sku_master;
BEGIN
  cands := public.sku_candidates(p_code);
  IF array_length(cands, 1) IS NULL THEN
    RETURN;
  END IF;
  FOREACH cand IN ARRAY cands LOOP
    SELECT * INTO found
    FROM public.sku_master
    WHERE public.normalize_code(sku) = cand
       OR public.normalize_code(barcode) = cand
    ORDER BY length(public.normalize_code(sku)) DESC
    LIMIT 1;
    IF found.sku IS NOT NULL THEN
      RETURN NEXT found;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

-- 5. Rebuild indexes so they reflect the updated normalize_code logic.
DROP INDEX IF EXISTS public.count_items_norm_sku_idx;
DROP INDEX IF EXISTS public.count_items_norm_barcode_idx;
DROP INDEX IF EXISTS public.barcode_aliases_norm_barcode_idx;
DROP INDEX IF EXISTS public.sku_master_norm_sku_idx;
DROP INDEX IF EXISTS public.sku_master_norm_barcode_idx;

CREATE INDEX IF NOT EXISTS count_items_norm_sku_idx
  ON public.count_items (cycle_id, public.normalize_code(sku));
CREATE INDEX IF NOT EXISTS count_items_norm_barcode_idx
  ON public.count_items (cycle_id, public.normalize_code(barcode));
CREATE INDEX IF NOT EXISTS barcode_aliases_norm_barcode_idx
  ON public.barcode_aliases (public.normalize_code(barcode));
CREATE INDEX IF NOT EXISTS sku_master_norm_sku_idx
  ON public.sku_master (public.normalize_code(sku));
CREATE INDEX IF NOT EXISTS sku_master_norm_barcode_idx
  ON public.sku_master (public.normalize_code(barcode));

GRANT EXECUTE ON FUNCTION public.normalize_code(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sku_candidates(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_count_item_by_code(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_master_sku_by_code(text) TO anon, authenticated, service_role;