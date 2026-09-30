-- ─────────────────────────────────────────────────────────────────────────────
-- Staff leaving — WHEEL MART (owner, 2026-09-30)
--
-- Leaving was only an Active switch: an inactive person dropped out of the
-- payroll that should have paid them, their advances and loan were stranded,
-- and a monthly person left active was proposed a full month.
--
-- employees:   left_on, leave_reason, leave_note. The person stays on the
--              payroll of the cycle they leave in (their final settlement)
--              and becomes inactive once that payroll is paid.
-- staff_loans: a loan balance the final pay can't cover is, case by case,
--              written off (the default) or kept as still owed.
--              written_off_amount comes off the balance; written_off_run ties
--              it to the payday so reopening that payroll puts it back.
-- expenses:    a written-off loan is a real loss of the business — booked as
--              'staff_loan_writeoff' (payment_method 'none': no money moves at
--              the write-off; it moved when the loan was given).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.employees add column if not exists left_on      date;
alter table public.employees add column if not exists leave_reason text;
alter table public.employees add column if not exists leave_note   text;

alter table public.staff_loans add column if not exists written_off_amount   integer not null default 0;
alter table public.staff_loans add column if not exists written_off_on       date;
alter table public.staff_loans add column if not exists written_off_run      uuid;
alter table public.staff_loans add column if not exists write_off_expense_id uuid;

alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check
  check (category = any (array[
    'grocery', 'rent', 'electricity', 'water', 'stationery', 'internet',
    'transport', 'maintenance', 'commission', 'other', 'salaries',
    'repairs', 'utilities', 'fuel', 'bank_charges', 'tax', 'petty_cash',
    'consumables', 'tools', 'insurance', 'advertising',
    'supplier_return_loss', 'staff_loan_writeoff'
  ]::text[]));

select 'staff leaving columns added' as status;
