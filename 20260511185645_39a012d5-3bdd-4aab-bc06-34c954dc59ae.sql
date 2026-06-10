
-- =========================
-- Roles
-- =========================
create type public.app_role as enum ('admin', 'verifier', 'counter');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  default_warehouse_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- =========================
-- Warehouses
-- =========================
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_default_warehouse_fkey
  foreign key (default_warehouse_id) references public.warehouses(id) on delete set null;

-- =========================
-- Cycle counts
-- =========================
create type public.cycle_status as enum ('draft', 'in_progress', 'verifying', 'finalized', 'cancelled');

create table public.cycle_counts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  status public.cycle_status not null default 'draft',
  due_date date,
  baseline_filename text,
  baseline_source text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  finalized_by uuid references auth.users(id)
);

create table public.cycle_assignments (
  cycle_id uuid not null references public.cycle_counts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (cycle_id, user_id)
);

-- =========================
-- Count items
-- =========================
create type public.item_status as enum ('uncounted', 'counted', 'recount', 'verified');

create table public.count_items (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycle_counts(id) on delete cascade,
  sku text,
  barcode text,
  location text,
  description text,
  uom text,
  expected_qty numeric not null default 0,
  counted_qty numeric,
  status public.item_status not null default 'uncounted',
  is_unexpected boolean not null default false,
  notes text,
  counted_by uuid references auth.users(id),
  counted_at timestamptz,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index count_items_cycle_idx on public.count_items(cycle_id);
create index count_items_barcode_idx on public.count_items(cycle_id, barcode);
create index count_items_location_idx on public.count_items(cycle_id, location);

-- =========================
-- Count events (audit trail)
-- =========================
create table public.count_events (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycle_counts(id) on delete cascade,
  item_id uuid references public.count_items(id) on delete set null,
  user_id uuid not null references auth.users(id),
  action text not null,
  qty_before numeric,
  qty_after numeric,
  source text,
  client_event_id text,
  created_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);

create index count_events_cycle_idx on public.count_events(cycle_id, created_at desc);

-- =========================
-- Email recipients
-- =========================
create table public.email_recipients (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid references public.warehouses(id) on delete cascade,
  email text not null,
  label text,
  created_at timestamptz not null default now()
);

-- =========================
-- updated_at triggers
-- =========================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger count_items_updated_at before update on public.count_items
  for each row execute function public.set_updated_at();

-- =========================
-- New user trigger: profile + default counter role
-- =========================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));

  insert into public.user_roles (user_id, role)
  values (new.id, 'counter');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================
-- RLS
-- =========================
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.warehouses enable row level security;
alter table public.cycle_counts enable row level security;
alter table public.cycle_assignments enable row level security;
alter table public.count_items enable row level security;
alter table public.count_events enable row level security;
alter table public.email_recipients enable row level security;

-- profiles
create policy "Users view own profile" on public.profiles
  for select to authenticated using (auth.uid() = id or public.has_role(auth.uid(), 'admin'));
create policy "Users update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id);
create policy "Admins manage profiles" on public.profiles
  for all to authenticated using (public.has_role(auth.uid(), 'admin'));

-- user_roles
create policy "Users view own roles" on public.user_roles
  for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));
create policy "Admins manage roles" on public.user_roles
  for all to authenticated using (public.has_role(auth.uid(), 'admin'));

-- warehouses
create policy "Authenticated view warehouses" on public.warehouses
  for select to authenticated using (true);
create policy "Admins manage warehouses" on public.warehouses
  for all to authenticated using (public.has_role(auth.uid(), 'admin'));

-- cycle_counts
create policy "Admin/verifier view all cycles" on public.cycle_counts
  for select to authenticated using (
    public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'verifier')
  );
create policy "Counters view assigned cycles" on public.cycle_counts
  for select to authenticated using (
    exists (
      select 1 from public.cycle_assignments
      where cycle_id = cycle_counts.id and user_id = auth.uid()
    )
  );
create policy "Admins insert cycles" on public.cycle_counts
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "Admins update cycles" on public.cycle_counts
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Admins delete cycles" on public.cycle_counts
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- cycle_assignments
create policy "View assignments (admin/verifier or self)" on public.cycle_assignments
  for select to authenticated using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'verifier')
    or user_id = auth.uid()
  );
create policy "Admins manage assignments" on public.cycle_assignments
  for all to authenticated using (public.has_role(auth.uid(), 'admin'));

-- count_items
create policy "View items (admin/verifier all, counter assigned)" on public.count_items
  for select to authenticated using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'verifier')
    or exists (
      select 1 from public.cycle_assignments a
      where a.cycle_id = count_items.cycle_id and a.user_id = auth.uid()
    )
  );
create policy "Admins insert items" on public.count_items
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "Counters update assigned items" on public.count_items
  for update to authenticated using (
    public.has_role(auth.uid(), 'admin')
    or (
      public.has_role(auth.uid(), 'verifier')
      and exists (
        select 1 from public.cycle_counts c
        where c.id = count_items.cycle_id and c.status in ('verifying','in_progress')
      )
    )
    or (
      exists (
        select 1 from public.cycle_assignments a
        join public.cycle_counts c on c.id = a.cycle_id
        where a.cycle_id = count_items.cycle_id
          and a.user_id = auth.uid()
          and c.status in ('draft','in_progress')
      )
    )
  );
create policy "Admins delete items" on public.count_items
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- count_events (append-only)
create policy "View events for visible cycles" on public.count_events
  for select to authenticated using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'verifier')
    or exists (
      select 1 from public.cycle_assignments a
      where a.cycle_id = count_events.cycle_id and a.user_id = auth.uid()
    )
  );
create policy "Insert own events" on public.count_events
  for insert to authenticated with check (user_id = auth.uid());

-- email_recipients
create policy "Authenticated view recipients" on public.email_recipients
  for select to authenticated using (true);
create policy "Admins manage recipients" on public.email_recipients
  for all to authenticated using (public.has_role(auth.uid(), 'admin'));
