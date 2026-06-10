-- Canonical SKU normalization.
-- Master SKUs follow 11111-11111 or 11111-11111-22 (10 or 12 alphanumerics, hyphenated).
-- Scanned variants may include hyphens, spaces, and an extra trailing barcode
-- character producing 11 or 13 normalized chars. Strip to the canonical
-- 10- or 12-char SKU body so all variants compare equal.
CREATE OR REPLACE FUNCTION public.normalize_code(code text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  compact text;
  len int;
BEGIN
  compact := regexp_replace(lower(coalesce(code, '')), '[^a-z0-9]', '', 'g');
  IF compact = '' THEN
    RETURN '';
  END IF;

  len := length(compact);

  -- SKU-with-extra-char variants: 11 -> 10, 13 -> 12.
  IF len = 11 THEN
    RETURN substr(compact, 1, 10);
  ELSIF len = 13 THEN
    RETURN substr(compact, 1, 12);
  END IF;

  RETURN compact;
END;
$function$;

-- Rebuild expression indexes so they use the updated function definition.
DROP INDEX IF EXISTS public.count_items_norm_sku_idx;
DROP INDEX IF EXISTS public.count_items_norm_barcode_idx;
DROP INDEX IF EXISTS public.barcode_aliases_norm_barcode_idx;

CREATE INDEX IF NOT EXISTS count_items_norm_sku_idx
  ON public.count_items (cycle_id, public.normalize_code(sku));
CREATE INDEX IF NOT EXISTS count_items_norm_barcode_idx
  ON public.count_items (cycle_id, public.normalize_code(barcode));
CREATE INDEX IF NOT EXISTS barcode_aliases_norm_barcode_idx
  ON public.barcode_aliases (public.normalize_code(barcode));

GRANT EXECUTE ON FUNCTION public.normalize_code(text) TO anon, authenticated, service_role;