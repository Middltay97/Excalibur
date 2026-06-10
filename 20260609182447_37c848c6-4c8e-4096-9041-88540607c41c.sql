-- Lock down cycle_active_counter: only admins can read; no client writes allowed.
-- The mobile-counter edge function uses the service role, which bypasses RLS.

CREATE POLICY "Admins view active counters"
  ON public.cycle_active_counter
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage active counters"
  ON public.cycle_active_counter
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));