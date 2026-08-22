-- ─────────────────────────────────────────────────────────────────────────────
-- Full history of promotions and their reversals
--
-- Promoting a receipt to a tax invoice and later reversing it are both events
-- that move output VAT, so neither can be left as a bare state change on the
-- sales row. This table records every one: who did it, when, which serial was
-- involved, and what the amounts were on each side.
--
-- Reversal is deliberately narrow (owner rule 2026-08-22):
--   * only a sale that was PROMOTED — an invoice raised as a tax invoice at
--     the till is voided, not un-promoted
--   * only for customers who are not VAT-registered
--   * only the LAST tax invoice of that entity, because later invoices carry
--     their date forward from it; unpicking a middle one would leave the ones
--     above it dated from a document that no longer exists. To reach an older
--     one, reverse the newer ones first and re-promote what is still wanted.
--   * only the owner, or a manager authorised for BOTH stores
--
-- The gazette serial is NOT handed back. It is voided and stays in the ledger,
-- because a printed invoice may already be in the customer's hands and the
-- sequence must never issue the same number twice. The sequence stays gapless
-- through the VOID row rather than through reuse.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.invoice_promotion_log (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references public.vendors(id) on delete cascade,
  sale_id      uuid references public.sales(id) on delete set null,

  action       text not null check (action in ('promote', 'reverse')),

  receipt_no   text,
  tax_serial   text,
  -- Which entity the sale sat under before and after the event
  from_entity_id uuid references public.invoice_entities(id),
  to_entity_id   uuid references public.invoice_entities(id),

  -- Amounts as they stood AFTER the event, so a reversal records the receipt
  -- figures it went back to
  total        integer,
  net_amount   integer,
  vat_amount   integer,
  -- The date printed on the invoice, and the day the sale actually happened
  stamped_date date,
  sale_date    date,

  reason       text,
  actor_id     uuid references auth.users(id),
  actor_role   text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_promotion_log_vendor
  on public.invoice_promotion_log (vendor_id, created_at desc);
create index if not exists idx_promotion_log_sale
  on public.invoice_promotion_log (sale_id);

alter table public.invoice_promotion_log enable row level security;

comment on table public.invoice_promotion_log is
  'Every promotion of a receipt to a tax invoice and every reversal. Owner / both-store manager only.';

-- Backfill the promotions made before this table existed, so the history is
-- complete rather than starting mid-story.
insert into public.invoice_promotion_log
  (vendor_id, sale_id, action, receipt_no, tax_serial, to_entity_id,
   total, net_amount, vat_amount, stamped_date, sale_date, reason, created_at)
select s.vendor_id, s.id, 'promote', s.promoted_from_receipt_no, s.tax_serial,
       s.invoice_entity_id, s.total::int, s.net_amount::int, s.vat_amount::int,
       s.date_supply, s.created_at::date,
       'Backfilled — promoted before the log existed', s.promoted_at
from public.sales s
where s.promoted_at is not null
  and not exists (
    select 1 from public.invoice_promotion_log l
    where l.sale_id = s.id and l.action = 'promote'
  );

-- ── Verify ──
select action, count(*) from public.invoice_promotion_log group by action;
