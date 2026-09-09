-- ═══════════════════════════════════════════════════════════════════════════
-- Input VAT as printed (owner + accountant, 2026-09-09)
--
-- The accountant files Schedule 02 from the suppliers' printed figures, and
-- IRD cross-matches our input claims against what each supplier declared on
-- their own Schedule 01, by TIN and invoice number. The system recomputed
-- VAT as 18% of our rounded line costs and could land a rupee or two off the
-- paper; and it held whole rupees only, while the paper carries cents.
--
-- The books stay in whole rupees. Alongside the integer fields, each input
-- document now carries the figures AS PRINTED, to two decimals, typed by the
-- operator and never recomputed. The Filing Centre and the schedules read
-- these when present and fall back to the integers when not, so nothing
-- already recorded changes until someone copies the paper in.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- Supplier tax invoices behind GRNs
alter table public.grns
  add column if not exists doc_net numeric(12,2),
  add column if not exists doc_vat numeric(12,2);

-- Overheads and consumables with input VAT
alter table public.expenses
  add column if not exists doc_net numeric(12,2),
  add column if not exists doc_vat numeric(12,2);

-- Credit notes a supplier issued to us (discounts, price adjustments)
alter table public.supplier_credit_notes
  add column if not exists doc_net numeric(12,2),
  add column if not exists doc_vat numeric(12,2);

-- Credit notes a supplier issued for goods we returned
alter table public.supplier_returns
  add column if not exists doc_credit_vat numeric(12,2);

-- Import VAT per CUSDEC
alter table public.import_vat_entries
  add column if not exists doc_vat_upfront numeric(12,2),
  add column if not exists doc_vat_deferred numeric(12,2),
  add column if not exists doc_disallowed_vat numeric(12,2);

-- ── Verify ──
select table_name, column_name, data_type, numeric_precision, numeric_scale
  from information_schema.columns
 where table_schema = 'public' and column_name like 'doc_%'
 order by table_name, column_name;
