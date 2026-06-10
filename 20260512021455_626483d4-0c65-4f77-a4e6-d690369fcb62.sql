create table if not exists public.cycle_active_counter (
  cycle_id uuid primary key references public.cycle_counts(id) on delete cascade,
  user_id uuid not null,
  badge_id text not null,
  acquired_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.cycle_active_counter enable row level security;
-- No policies: only service role (mobile-counter edge function) accesses this.