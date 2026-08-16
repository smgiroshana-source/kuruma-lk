-- ─────────────────────────────────────────────────────────────────────────────
-- Payment methods actually used: cash, bank, cheque
--
-- The table was created allowing cash/bank/card. No card is ever used here —
-- and a card payment is a bank payment anyway — while cheques, which the shop
-- does use, were not allowed at all. 'card' stays valid so existing rows keep
-- saving; the form no longer offers it.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.expenses drop constraint if exists expenses_payment_method_check;

alter table public.expenses add constraint expenses_payment_method_check check (
  payment_method in ('cash', 'bank', 'cheque', 'card')
);

select 'payment methods updated' as status;
