CREATE TABLE public.barcode_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL,
  barcode text NOT NULL UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_barcode_aliases_sku ON public.barcode_aliases(sku);

ALTER TABLE public.barcode_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated view aliases"
  ON public.barcode_aliases FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated insert aliases"
  ON public.barcode_aliases FOR INSERT
  TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "Admins update aliases"
  ON public.barcode_aliases FOR UPDATE
  TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete aliases"
  ON public.barcode_aliases FOR DELETE
  TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));