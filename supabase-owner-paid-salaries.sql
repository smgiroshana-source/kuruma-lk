-- ─────────────────────────────────────────────────────────────────────────────
-- Salaries paid from the owner's own money — WHEEL MART (owner, 2026-09-24)
--
-- The owner usually pays staff from their own cash, not from the drawer or
-- the bank. Payday still books each person's pay as a 'salaries' expense (it
-- is the company's cost), but with payment_method = 'owner': no drawer
-- session, no bank movement, and the cash-flow report shows it apart from
-- money the business itself paid out.
--
-- Adds 'owner' to the two payment-method checks. Nothing existing changes.
-- 'none' stays: supplier-return losses use it (supabase-supplier-return-credit.sql).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.expenses drop constraint if exists expenses_payment_method_check;

alter table public.expenses add constraint expenses_payment_method_check check (
  payment_method in ('cash', 'online', 'cheque', 'bank', 'card', 'none', 'owner')
);

alter table public.payroll_runs drop constraint if exists payroll_runs_payment_method_check;

alter table public.payroll_runs add constraint payroll_runs_payment_method_check check (
  payment_method in ('cash', 'online', 'cheque', 'bank', 'owner')
);

select 'owner-paid salaries enabled' as status;
