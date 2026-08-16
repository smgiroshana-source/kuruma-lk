-- ─────────────────────────────────────────────────────────────────────────────
-- Payment methods actually used: CASH, ONLINE, CHEQUE
--
-- The table was created allowing cash/bank/card. "Bank" was ambiguous — a
-- cheque is a bank payment too — so a transfer is now 'online'. No card is
-- ever used, and a card payment would have been an online bank movement.
--
-- 'bank' and 'card' stay valid so nothing already recorded breaks; existing
-- rows are migrated to 'online', and the form no longer offers either.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.expenses drop constraint if exists expenses_payment_method_check;

alter table public.expenses add constraint expenses_payment_method_check check (
  payment_method in ('cash', 'online', 'cheque', 'bank', 'card')
);

update public.expenses set payment_method = 'online'
 where payment_method in ('bank', 'card');

-- Payroll pays out the same three ways
alter table public.payroll_runs drop constraint if exists payroll_runs_payment_method_check;

alter table public.payroll_runs add constraint payroll_runs_payment_method_check check (
  payment_method in ('cash', 'online', 'cheque', 'bank')
);

update public.payroll_runs set payment_method = 'online' where payment_method = 'bank';

select 'payment methods updated' as status;
