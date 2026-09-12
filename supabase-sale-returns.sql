-- ═══════════════════════════════════════════════════════════════════════════
-- Why a return happened (owner, 2026-09-12)
--
-- Of Rs.5.8M returned at Sakura since April, nearly half was paperwork —
-- a wrong invoice returned and re-billed — and none of the 36 returns had
-- a reason recorded, so the split had to be inferred by pairing items with
-- later invoices. The return dialog now asks before it saves, and every
-- return event is one row here: till returns and credit notes alike.
--
--   rebill      wrong invoice — re-billing (paperwork, no goods moved)
--   goods_back  goods came back and can be sold again
--   faulty      goods came back but are not sellable as they are
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.sale_returns (
  id                uuid primary key default gen_random_uuid(),
  vendor_id         uuid not null references public.vendors(id),
  sale_id           uuid not null references public.sales(id),
  kind              text not null check (kind in ('rebill', 'goods_back', 'faulty')),
  reason            text,
  rebill_invoice_no text,
  credit_note_no    text,
  amount            integer not null default 0,
  items             jsonb,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);

create index if not exists idx_sale_returns_vendor_time on public.sale_returns (vendor_id, created_at desc);
create index if not exists idx_sale_returns_sale on public.sale_returns (sale_id);

alter table public.sale_returns enable row level security;
alter table public.sale_returns force row level security;
revoke all on table public.sale_returns from anon, authenticated;

-- ── Verify ──
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'sale_returns' order by ordinal_position;
