-- ─────────────────────────────────────────────────────────────────────────────
-- Promoting a proprietor receipt to a Pvt Ltd tax invoice
--
-- Within 30 days, for customers who are not VAT-registered. The sale keeps its
-- receipt number — the customer is holding that piece of paper and the receipt
-- sequence has to stay gapless — and gains a gazette serial alongside it.
-- These two columns record that it happened, and what it was before.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sales
  add column if not exists promoted_at timestamptz,
  add column if not exists promoted_from_receipt_no text;

comment on column public.sales.promoted_from_receipt_no is
  'The receipt this sale was issued under before it became a tax invoice. Kept so the customer''s copy can still be traced.';

create index if not exists idx_sales_promoted on public.sales (vendor_id, promoted_at)
  where promoted_at is not null;

select count(*) as promoted from public.sales where promoted_at is not null;
