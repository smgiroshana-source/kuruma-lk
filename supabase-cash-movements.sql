-- ─────────────────────────────────────────────────────────────────────────────
-- Money moved, not money earned
--
-- Owner tops up the float, cash is drawn from the bank for the till, the
-- day's takings are banked, the owner takes drawings. None of this is income
-- or expense — profit must never see it — but every one changes what the
-- drawer should hold, so the cash count needs it recorded.
--
-- Kept apart from expenses (which reduce profit) and from cash corrections
-- (which fix mistakes): these are routine, legitimate movements.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null,
  movement_date date not null,
  type text not null check (type in ('owner_in', 'bank_in', 'to_bank', 'owner_out')),
  amount integer not null check (amount > 0),
  note text,
  created_by text,
  created_at timestamptz default now()
);

create index if not exists cash_movements_date_idx
  on public.cash_movements (vendor_id, movement_date);

alter table public.cash_movements enable row level security;

comment on table public.cash_movements is
  'Capital/transfer cash movements — affect the drawer count, never profit';

-- POS card fee % joins the config (not hardcoded, per house rule)
select 'cash movements ready' as status;
