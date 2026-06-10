ALTER TABLE public.cycle_counts
  ADD COLUMN IF NOT EXISTS count_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS count_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS verify_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS verify_ended_at timestamptz;