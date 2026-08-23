-- ─────────────────────────────────────────────────────────────────────────────
-- Scheduled salary increases
--
-- Replaces the line in the salary sheet that reads "From 2027 Apr salary -
-- 60,000". A raise is agreed months ahead and then forgotten until someone
-- notices the payslip is wrong — usually the person being underpaid.
--
-- The increase is recorded against the pay item it changes, with the month it
-- takes effect. It is NOT applied silently on that date: money that changes
-- itself is money nobody checks. The owner is reminded when it falls due and
-- applies it in one click, and the record keeps what the amount was before, so
-- a payslip query months later can be answered from the system.
--
-- Only the base pay item is expected in practice, but any pay item can be
-- scheduled — an allowance rises too.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.salary_increments (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  -- Which pay item rises. Nullable so a scheduled raise survives the pay item
  -- being restructured; the label below still says what was meant.
  pay_item_id   uuid references public.employee_pay_items(id) on delete set null,
  item_label    text,

  -- Always the 1st of the month it takes effect: a raise runs from a payroll
  -- period, not from a day in the middle of one.
  effective_from date not null,
  new_amount     integer not null check (new_amount >= 0),
  -- What it was, captured when applied, so the change is readable afterwards
  previous_amount integer,

  note          text,
  status        text not null default 'scheduled'
                check (status in ('scheduled', 'applied', 'cancelled')),
  applied_at    timestamptz,
  applied_by    uuid references auth.users(id),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),

  -- One scheduled change per pay item per month; a second is an edit, not a
  -- second raise.
  constraint salary_increments_unique unique (employee_id, pay_item_id, effective_from)
);

create index if not exists idx_salary_increments_due
  on public.salary_increments (vendor_id, status, effective_from);

alter table public.salary_increments enable row level security;

comment on table public.salary_increments is
  'Salary rises agreed in advance. Reminds the owner in the month they fall due; applied deliberately, never silently.';

-- ── Verify ──
select status, count(*) from public.salary_increments group by status;
