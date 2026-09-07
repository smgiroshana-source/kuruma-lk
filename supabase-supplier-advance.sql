-- ═══════════════════════════════════════════════════════════════════════════
-- Supplier prepayments (owner, 2026-09-06)
--
-- WHEEL MART sometimes pays a supplier before there is any invoice — a
-- deposit on an order, or money sent ahead. The payables screen could only
-- record a payment against an existing invoice, so there was nowhere to put
-- it. Now a payment with no invoice sits on the supplier's account as a
-- prepayment and settles their next invoices (automatically when an invoice
-- is created or a GRN is posted, or by hand from the invoice list).
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- Unapplied prepayments, in whole rupees. Goes up when a payment is recorded
-- with no invoice, down as it is applied.
alter table public.suppliers
  add column if not exists advance_balance integer not null default 0;

alter table public.suppliers drop constraint if exists suppliers_advance_balance_check;
alter table public.suppliers add constraint suppliers_advance_balance_check
  check (advance_balance >= 0);

-- 'advance' = an invoice settled from the prepayment. No cash moves on that
-- row; the cash moved when the prepayment itself was recorded. Kept as a
-- payment row so the invoice's paid total and history read the same as any
-- other settlement. Legacy spellings stay allowed, as in the previous
-- version of this constraint (supabase-supplier-payment-method-check.sql).
alter table public.supplier_payments drop constraint if exists supplier_payments_method_check;
alter table public.supplier_payments add constraint supplier_payments_method_check check (
  method in ('cash', 'online', 'cheque', 'bank', 'card', 'advance')
);

-- Prepayment rows have no invoice; find them per supplier quickly.
create index if not exists idx_supplier_payments_prepay
  on public.supplier_payments (vendor_id, supplier_id, payment_date desc)
  where supplier_invoice_id is null;

-- ── Verify ──
select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'suppliers' and column_name = 'advance_balance';
select pg_get_constraintdef(oid) as method_check
  from pg_constraint where conname = 'supplier_payments_method_check';
