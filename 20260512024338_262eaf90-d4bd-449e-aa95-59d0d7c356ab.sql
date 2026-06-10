
CREATE TABLE public.sku_master (
  sku text PRIMARY KEY,
  barcode text,
  description text,
  location text,
  uom text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE INDEX idx_sku_master_barcode ON public.sku_master(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_sku_master_location ON public.sku_master(location) WHERE location IS NOT NULL;

ALTER TABLE public.sku_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated view sku_master"
  ON public.sku_master FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins insert sku_master"
  ON public.sku_master FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update sku_master"
  ON public.sku_master FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete sku_master"
  ON public.sku_master FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_sku_master_updated_at
  BEFORE UPDATE ON public.sku_master
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
