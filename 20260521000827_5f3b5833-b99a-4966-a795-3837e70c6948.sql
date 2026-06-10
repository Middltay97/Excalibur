-- Improve SKU/barcode normalization for scan matching.
-- Handles:
--   5325306010      -> 5325306010
--   53253-06010     -> 5325306010
--   53253-06010 P   -> 5325306010
--   44250-04041-84  -> 442500404184
CREATE OR REPLACE FUNCTION public.normalize_code(code text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  raw text := lower(trim(coalesce(code, '')));
  extracted text;
BEGIN
  IF raw = '' THEN
    RETURN '';
  END IF;

  -- If a distribution-center tag appends one separated character/digit,
  -- remove only that separated suffix before normalizing.
  raw := regexp_replace(raw, '\s+[a-z0-9]\s*$', '');

  -- Prefer a SKU-shaped token: 5 alphanumeric, optional hyphen/space,
  -- 5 alphanumeric, optional hyphen/space and up to 2 alphanumeric.
  -- This captures both formatted and unformatted SKUs, with max 12 chars.
  extracted := substring(raw from '([a-z0-9]{5}[-[:space:]]?[a-z0-9]{5}(?:[-[:space:]]?[a-z0-9]{1,2})?)');

  IF extracted IS NOT NULL THEN
    RETURN left(regexp_replace(extracted, '[^a-z0-9]', '', 'g'), 12);
  END IF;

  -- Fallback for true barcodes/aliases: ignore punctuation like hyphens.
  RETURN regexp_replace(raw, '[^a-z0-9]', '', 'g');
END;
$$;

-- Recreate expression indexes so they use the updated normalization function.
DROP INDEX IF EXISTS public.count_items_norm_sku_idx;
DROP INDEX IF EXISTS public.count_items_norm_barcode_idx;
DROP INDEX IF EXISTS public.barcode_aliases_norm_barcode_idx;

CREATE INDEX IF NOT EXISTS count_items_norm_sku_idx
  ON public.count_items (cycle_id, public.normalize_code(sku));
CREATE INDEX IF NOT EXISTS count_items_norm_barcode_idx
  ON public.count_items (cycle_id, public.normalize_code(barcode));
CREATE INDEX IF NOT EXISTS barcode_aliases_norm_barcode_idx
  ON public.barcode_aliases (public.normalize_code(barcode));

CREATE OR REPLACE FUNCTION public.find_count_item_by_code(p_cycle_id uuid, p_code text)
RETURNS SETOF public.count_items
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  n text := public.normalize_code(p_code);
  alias_sku text;
BEGIN
  IF n = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT * FROM public.count_items
    WHERE cycle_id = p_cycle_id
      AND (public.normalize_code(sku) = n OR public.normalize_code(barcode) = n)
    ORDER BY is_unexpected ASC, created_at ASC
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
      ORDER BY is_unexpected ASC, created_at ASC
      LIMIT 1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_code(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_count_item_by_code(uuid, text) TO anon, authenticated, service_role;