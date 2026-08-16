-- ═══════════════════════════════════════════════════════════════════════════
-- WHEEL MART Staff/HR — stage 2: the monthly payroll run
--
-- Until now salary only reached the books when someone took an ADVANCE, so
-- monthly profit was understated by everything paid on payday, and advances
-- piled up against a person with nothing ever netting them off.
--
-- A run closes one month: what each person earned (base prorated by attendance,
-- daily allowances, commissions, share of profit), less EPF and less the
-- advances they already took, leaving the balance actually handed over. Marking
-- it paid posts one salaries expense per person so the cash book and the drawer
-- both reconcile.
--
-- Owner-only data: RLS on, no policies — everything goes through the API.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null,
  period text not null,                     -- 'YYYY-MM'
  status text not null default 'draft' check (status in ('draft','paid')),
  paid_date date,                           -- the day the money went out
  payment_method text default 'cash' check (payment_method in ('cash','bank')),
  gross_total integer not null default 0,
  deduction_total integer not null default 0,
  advance_total integer not null default 0,
  net_total integer not null default 0,
  note text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- One run per month per company: a second run would pay everyone twice
  unique (vendor_id, period)
);

create table if not exists public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  -- Snapshot: a payslip must still read correctly after someone is renamed
  employee_name text not null,
  branch text,
  days_present numeric not null default 0,
  days_half numeric not null default 0,
  days_absent numeric not null default 0,
  payable_days numeric not null default 0,
  -- [{ kind, label, qty, rate, amount }] — every component, as paid
  components jsonb not null default '[]'::jsonb,
  gross integer not null default 0,
  deductions integer not null default 0,
  advances integer not null default 0,
  net_pay integer not null default 0,
  expense_id uuid,                          -- the salaries expense posted on payday
  note text,
  created_at timestamptz default now(),
  unique (run_id, employee_id)
);

create index if not exists payroll_runs_period_idx on public.payroll_runs (vendor_id, period);
create index if not exists payroll_lines_run_idx on public.payroll_lines (run_id);
create index if not exists payroll_lines_emp_idx on public.payroll_lines (employee_id);

alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;

comment on table public.payroll_runs is 'WHEEL MART monthly payroll — one run per month, posts salaries expenses when paid';
comment on column public.payroll_lines.components is 'Every pay component as actually paid: kind, label, qty, rate, amount';

select 'payroll ready' as status;
