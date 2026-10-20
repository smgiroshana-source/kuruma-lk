-- ═══════════════════════════════════════════════════════════════════════════
-- Tax deadlines on the dashboard — WHEEL MART (owner, 2026-10-20)
--
-- The owner pays VAT and SSCL and files the returns. The dashboard reminds
-- them of each deadline from a week before:
--   VAT payment   for month M — 20th of M+1
--   VAT return    for month M — last day of M+1
--   SSCL payment  for month M — 20th of M+1
--   SSCL return   for a quarter — 20th of the month after it ends
-- Ticking "Done" records it here, which clears that reminder. Nothing in this
-- table is an expense: VAT never touches profit, and SSCL is charged to profit
-- from the period's sales (profit-report), not from these payments.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.tax_obligations_done (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references public.vendors(id) on delete cascade,
  kind       text not null check (kind in ('vat_payment', 'vat_return', 'sscl_payment', 'sscl_return')),
  period     text not null check (period ~ '^\d{4}-(\d{2}|Q[1-4])$'),   -- 2026-09 or 2026-Q3
  done_at    timestamptz not null default now(),
  done_by    text,
  amount     numeric,                                                    -- what was paid, if typed
  paid_from  text check (paid_from in ('owner', 'bank', 'cash')),
  note       text,
  unique (vendor_id, kind, period)
);

alter table public.tax_obligations_done enable row level security;

select 'tax deadlines table added' as status;
