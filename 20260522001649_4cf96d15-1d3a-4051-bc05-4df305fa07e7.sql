CREATE OR REPLACE FUNCTION public.normalize_code(code text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  raw text := lower(trim(coalesce(code, '')));
  compact text;
  match_parts text[];
BEGIN
  IF raw = '' THEN
    RETURN '';
  END IF;

  -- Distribution-center tags may append one separated character/digit,
  -- for example: 53253-06010 P. Remove only that separated suffix.
  raw := regexp_replace(raw, '\s+[a-z0-9]\s*$', '');
  compact := regexp_replace(raw, '[^a-z0-9]', '', 'g');

  IF compact = '' THEN
    RETURN '';
  END IF;

  -- If the scan is already one uninterrupted code, keep the full value so
  -- longer UPC/EAN/barcode values continue to match barcode fields exactly.
  IF raw ~ '^[a-z0-9]+$' THEN
    RETURN compact;
  END IF;

  -- Otherwise look for the SKU format inside the scanned text:
  -- 5 chars + 5 chars + optional 1-2 chars, with optional hyphens/spaces.
  match_parts := regexp_match(
    raw,
    '(^|[^a-z0-9])([a-z0-9]{5}[-[:space:]]?[a-z0-9]{5}([-[:space:]]?[a-z0-9]{1,2})?)($|[^a-z0-9])'
  );

  IF match_parts IS NOT NULL THEN
    RETURN regexp_replace(match_parts[2], '[^a-z0-9]', '', 'g');
  END IF;

  -- Fallback: punctuation-insensitive matching for manually entered aliases.
  RETURN compact;
END;
$$;

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