-- ═══════════════════════════════════════════════════════════════════════════
-- Staff loans, and advances that outrun a month's pay (owner, 2026-09-23)
--
-- 1. LOANS. The owner lends a person money to be taken back from salary a
--    fixed instalment a month. An advance can't do this: payroll deducts every
--    unsettled advance in full on the next payday. A loan keeps its own
--    balance; each paid payroll run records what came off it.
--
-- 2. CARRIED BALANCES. When advances exceed a month's pay, payday paid
--    nothing and marked every advance settled — the shortfall was written off
--    while the screen said "the balance stays owing". It now becomes an advance
--    dated the first day of the next cycle (source 'carried'), linked to the
--    run that created it so reopening the run takes it back.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.staff_loans (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references public.vendors(id),
  employee_id  uuid not null references public.employees(id),
  amount       integer not null check (amount > 0),
  instalment   integer not null check (instalment > 0),
  date         date not null,
  source       text not null default 'drawer' check (source in ('drawer', 'bank', 'owner')),
  note         text,
  expense_id   uuid,            -- the cash-book row for drawer/bank loans
  entered_by   text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_staff_loans_emp on public.staff_loans (vendor_id, employee_id);

create table if not exists public.staff_loan_repayments (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references public.vendors(id),
  loan_id      uuid not null references public.staff_loans(id),
  employee_id  uuid not null references public.employees(id),
  run_id       uuid not null references public.payroll_runs(id) on delete cascade,
  amount       integer not null check (amount > 0),
  created_at   timestamptz not null default now()
);
create index if not exists idx_staff_loan_repayments_loan on public.staff_loan_repayments (loan_id);
create index if not exists idx_staff_loan_repayments_run on public.staff_loan_repayments (run_id);

-- Carried balances: which run created them, and a source that says so
alter table public.staff_advances
  add column if not exists carried_from_run uuid references public.payroll_runs(id);

do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.staff_advances'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.staff_advances drop constraint %I', c);
  end loop;
end $$;
alter table public.staff_advances
  add constraint staff_advances_source_check check (source in ('drawer', 'bank', 'owner', 'carried'));

-- Locked down like every other table: service role only
alter table public.staff_loans enable row level security;
alter table public.staff_loans force row level security;
revoke all on table public.staff_loans from anon, authenticated;
alter table public.staff_loan_repayments enable row level security;
alter table public.staff_loan_repayments force row level security;
revoke all on table public.staff_loan_repayments from anon, authenticated;

-- ── Verify ──
select table_name, column_name from information_schema.columns
 where table_schema = 'public'
   and (table_name in ('staff_loans', 'staff_loan_repayments') or (table_name = 'staff_advances' and column_name = 'carried_from_run'))
 order by table_name, ordinal_position;
