
DROP POLICY IF EXISTS "Authenticated view allocation rules" ON public.count_allocation_rules;
CREATE POLICY "Admins view allocation rules"
  ON public.count_allocation_rules FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated insert aliases" ON public.barcode_aliases;
CREATE POLICY "Admins insert aliases"
  ON public.barcode_aliases FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND created_by = auth.uid());
