-- ─────────────────────────────────────────────────────────────────────────────
-- supplier_payments.method: allow 'online'
--
-- The methods were renamed to cash / online / cheque and the existing ROWS were
-- migrated, but this table's CHECK constraint still listed the old set
-- (cash/bank/cheque/card) — so every online supplier payment was rejected by
-- the database. Legacy values stay allowed so nothing already recorded breaks.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.supplier_payments drop constraint if exists supplier_payments_method_check;

alter table public.supplier_payments add constraint supplier_payments_method_check check (
  method in ('cash', 'online', 'cheque', 'bank', 'card')
);

-- Anything left on the old spelling follows the rename
update public.supplier_payments set method = 'online' where method in ('bank', 'card');

select method, count(*) from public.supplier_payments group by method;
