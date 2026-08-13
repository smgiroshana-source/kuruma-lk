-- ═══════════════════════════════════════════════════════════════════════════
-- WHEEL MART Staff / HR — stage 1 (registry, pay items, attendance, advances)
-- Run ONCE in the kuruma project's SQL Editor.
-- All access goes through the kuruma API (service role) with per-role
-- filtering; RLS is enabled with NO policies so the anon/authenticated keys
-- can never read pay data directly.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null,
  name text not null,
  nic text, phone text, address text,
  branch text not null default 'shop' check (branch in ('shop','workshop')),
  join_date date,
  pay_type text not null default 'monthly' check (pay_type in ('monthly','daily','contract')),
  active boolean not null default true,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One row per pay component. visible_to_office decides whether managers/office
-- staff ever RECEIVE the row from the API (owner sees all).
create table if not exists public.employee_pay_items (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null check (kind in ('base','allowance','commission_rate','profit_rate','epf','other')),
  label text not null,
  amount numeric not null default 0,
  unit text not null default 'rs' check (unit in ('rs','percent')),
  period text not null default 'monthly' check (period in ('monthly','daily','per_event')),
  half_day_policy text not null default 'half' check (half_day_policy in ('half','none','full')),
  visible_to_office boolean not null default false,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present','half','absent')),
  marked_by text,
  created_at timestamptz default now(),
  unique (employee_id, date)
);

create table if not exists public.staff_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  vendor_id uuid not null,
  amount integer not null check (amount > 0),
  date date not null,
  source text not null default 'drawer' check (source in ('drawer','bank','owner')),
  note text,
  expense_id uuid,           -- linked expenses row (drawer/bank sources)
  settled_in_run uuid,       -- stage 2: payroll run that deducted it
  entered_by text,
  created_at timestamptz default now()
);

create table if not exists public.staff_audit (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null,
  actor text not null,
  action text not null,
  employee_id uuid,
  detail jsonb,
  created_at timestamptz default now()
);

create index if not exists staff_att_date_idx on public.staff_attendance (date);
create index if not exists staff_adv_emp_idx on public.staff_advances (employee_id);

-- Service-role only: RLS on, zero policies
alter table public.employees enable row level security;
alter table public.employee_pay_items enable row level security;
alter table public.staff_attendance enable row level security;
alter table public.staff_advances enable row level security;
alter table public.staff_audit enable row level security;

comment on table public.employees is 'WHEEL MART Staff/HR — one registry for shop + workshop';
comment on table public.employee_pay_items is 'Pay components with per-item office visibility (owner-only by default)';

select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'staff%' or tablename in ('employees','employee_pay_items');
