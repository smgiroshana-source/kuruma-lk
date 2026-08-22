-- ─────────────────────────────────────────────────────────────────────────────
-- Promoting a proprietor receipt to a Pvt Ltd tax invoice
--
-- Within 30 days, for customers who are not VAT-registered. The sale keeps its
-- receipt number — the customer is holding that piece of paper and the receipt
-- sequence has to stay gapless — and gains a gazette serial alongside it.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sales
  add column if not exists promoted_at timestamptz,
  add column if not exists promoted_from_receipt_no text;

comment on column public.sales.promoted_from_receipt_no is
  'The receipt this sale was issued under before it became a tax invoice. Kept so the customer''s copy can still be traced.';

create index if not exists idx_sales_promoted on public.sales (vendor_id, promoted_at)
  where promoted_at is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reclaim gazette serials that were minted but never issued
--
-- next_invoice_serial commits the moment it is called. Promote attempts that
-- failed afterwards (the columns above were missing) each burned a number:
-- the counter advanced but no document carries it, leaving a hole in a
-- sequence the gazette requires to be gapless.
--
-- Nothing was ever printed under those numbers, so winding the counter back to
-- the highest serial actually on a sale is a true correction, not a reuse.
-- Runs only where the counter is AHEAD of reality, so it is safe to re-run and
-- cannot disturb a sequence that is already correct.
-- ─────────────────────────────────────────────────────────────────────────────

with used as (
  select s.invoice_entity_id as entity_id,
         split_part(s.tax_serial, '_', 1) as period,
         max(split_part(s.tax_serial, '_', 3)::int) as highest
  from public.sales s
  where s.tax_serial is not null
  group by 1, 2
)
update public.invoice_sequences q
   set last_number = used.highest
  from used
 where q.entity_id = used.entity_id
   and q.period    = used.period
   and q.last_number > used.highest;

-- ── Verify ── counter should equal the highest serial actually issued
select q.period, q.last_number as counter,
       (select max(split_part(s.tax_serial, '_', 3)::int)
          from public.sales s
         where s.invoice_entity_id = q.entity_id
           and split_part(s.tax_serial, '_', 1) = q.period) as highest_issued
from public.invoice_sequences q
order by q.period;
