ALTER TABLE public.cycle_counts
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE INDEX IF NOT EXISTS idx_cycle_counts_archived_at
  ON public.cycle_counts(archived_at);