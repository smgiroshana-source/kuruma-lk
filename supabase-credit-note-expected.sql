-- ─────────────────────────────────────────────────────────────────────────────
-- "Credit note expected" on a supplier bill — WHEEL MART (owner, 2026-09-30)
--
-- Paying a bill short leaves a balance. The system can't tell a balance we
-- will pay later from one the supplier is going to cancel with a credit note
-- (Prime Lanka PLTV 00097: paid Rs.91,822 of Rs.96,654, 5% discount, credit
-- note to follow). Staff say which at payday; this records it:
--   cn_expected_amount  how much of the balance the note is expected to cover
--   cn_expected_since   the day it was marked (the chase clock)
--   cn_expected_by      who marked it
-- A marked amount is not "money to pay": it is kept out of overdue and shown
-- as "credit notes still to come" until the note is entered. Entering the
-- note, or the bill being settled any other way, clears it.
--
-- New columns only; nothing existing changes. RLS on the table is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.supplier_invoices add column if not exists cn_expected_amount integer;
alter table public.supplier_invoices add column if not exists cn_expected_since  date;
alter table public.supplier_invoices add column if not exists cn_expected_by     uuid;

alter table public.supplier_invoices drop constraint if exists supplier_invoices_cn_expected_check;
alter table public.supplier_invoices add constraint supplier_invoices_cn_expected_check
  check (cn_expected_amount is null or cn_expected_amount > 0);

select 'credit note expected columns added' as status;
