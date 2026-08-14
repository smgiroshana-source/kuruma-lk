-- ─────────────────────────────────────────────────────────────────────────────
-- Input VAT on overheads and consumables
--
-- Not everything we buy is for resale. Electricity, telephone, rent, stationery,
-- workshop consumables (grease, rags, sandpaper), small tools — all carry VAT
-- we can claim, provided the supplier is VAT-registered and gave us a proper
-- tax invoice in the company's name.
--
-- These land on IRD VAT Schedule 02 exactly like a local stock purchase, so the
-- expense needs the same fields a GRN carries: supplier, TIN, invoice number
-- and date, and the VAT split out of the amount paid.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.expenses
  add column if not exists supplier_name         text,
  add column if not exists supplier_tin          text,
  add column if not exists supplier_invoice_no   text,
  add column if not exists supplier_invoice_date date,
  -- 0 = nothing to claim (no tax invoice, or a non-VAT supplier)
  add column if not exists input_vat             integer not null default 0,
  -- 'YYYY-MM' parks the credit in a later month; null = claim in its own month
  add column if not exists vat_claim_period      text;

-- The Filing Centre sweeps claimable expenses by period every time it loads
create index if not exists expenses_input_vat_idx
  on public.expenses (vendor_id, vat_claim_period) where input_vat > 0;

comment on column public.expenses.input_vat is
  'Input VAT claimable on this expense (whole LKR). Requires a valid tax invoice from a VAT-registered supplier.';
