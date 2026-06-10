-- Harden normalize_code() to fold unicode dashes / strip control chars BEFORE
-- the alphanumeric strip. Output is unchanged for clean ASCII inputs.
CREATE OR REPLACE FUNCTION public.normalize_code(code text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          translate(
            coalesce(code, ''),
            E'\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00A0\r\n\t',
            '----------'
          ),
          '\.\d+$', ''
        ),
        '[^A-Za-z0-9]', '', 'g'
      ),
      '\s+', '', 'g'
    )
  );
$function$;

-- normalize_bin: trim/strip control chars + fold unicode dashes + uppercase,
-- but PRESERVE digits/letters/leading zeros. Bins like "0125" and "125" remain
-- distinct here; equivalence (leading-zero tolerance) is handled in the app
-- via binsMatch().
CREATE OR REPLACE FUNCTION public.normalize_bin(bin text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT upper(
    regexp_replace(
      btrim(
        translate(
          coalesce(bin, ''),
          E'\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00A0\r\n\t',
          '----------'
        )
      ),
      '\s+', ' ', 'g'
    )
  );
$function$;

-- Additive flag for precise "wrong bin" detection. Does not replace
-- is_unexpected; both can coexist.
ALTER TABLE public.count_items
  ADD COLUMN IF NOT EXISTS mislocated boolean NOT NULL DEFAULT false;

-- Diagnostic capture for every failed/abnormal scan. Admin-only read.
CREATE TABLE IF NOT EXISTS public.scan_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  cycle_id uuid,
  badge_id text,
  user_id uuid,
  raw text NOT NULL,
  normalized text,
  length int,
  char_codes int[],
  lookup_key text,
  candidate_keys text[],
  result_status text NOT NULL,
  closest_master_sku text,
  notes jsonb
);

GRANT SELECT, INSERT ON public.scan_diagnostics TO authenticated;
GRANT ALL ON public.scan_diagnostics TO service_role;

ALTER TABLE public.scan_diagnostics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view scan diagnostics"
  ON public.scan_diagnostics FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated insert scan diagnostics"
  ON public.scan_diagnostics FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS scan_diagnostics_created_at_idx
  ON public.scan_diagnostics (created_at DESC);
CREATE INDEX IF NOT EXISTS scan_diagnostics_status_idx
  ON public.scan_diagnostics (result_status);
CREATE INDEX IF NOT EXISTS scan_diagnostics_cycle_idx
  ON public.scan_diagnostics (cycle_id);