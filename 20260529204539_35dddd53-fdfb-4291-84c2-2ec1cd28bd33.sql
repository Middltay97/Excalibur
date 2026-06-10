DROP POLICY IF EXISTS "Authenticated insert scan diagnostics" ON public.scan_diagnostics;
REVOKE INSERT ON public.scan_diagnostics FROM authenticated;