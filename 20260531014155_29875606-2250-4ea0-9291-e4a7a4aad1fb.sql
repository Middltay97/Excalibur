ALTER TABLE public.sku_master
  ADD COLUMN IF NOT EXISTS is_ancillary boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS sku_master_is_ancillary_idx
  ON public.sku_master (is_ancillary);