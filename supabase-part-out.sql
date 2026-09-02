-- ═══════════════════════════════════════════════════════════════════════════
-- Selling a piece off a complete assembly (owner, 2026-09-02)
--
-- A door complete, a bumper assy, a radiator with condenser: a customer wants
-- only the mirror, or only the condenser. Until now there was no way to say so.
-- The piece was sold as a typed line with no product behind it, the assembly
-- still read as complete, and the next customer had no way to know the mirror
-- was already gone.
--
-- 493 products are named "complete", "assy", "set" or "kit" — 398 Sakura, 95
-- WHEEL MART — so this is the trade, not an edge case.
--
-- A removed piece becomes a product in its own right, linked back to what it
-- came off. That way it can sit in stock unsold, be found in search, be
-- transferred to the other branch, or be sold at the counter — all through the
-- paths that already exist, with no special case in POS, invoicing, VAT, SSCL,
-- returns or the reports.
--
-- Cost travels with the piece. A mirror taken off a Rs.40,000 door and sold for
-- Rs.8,000 against no cost reads as 100% margin, while the door keeps the whole
-- Rs.40,000 and later sells at an invented loss. Neither figure is true, so the
-- operator says how much of the parent's cost goes with the piece, and it is
-- moved — reference cost and FIFO layer alike.
-- ═══════════════════════════════════════════════════════════════════════════

-- The live link: a child knows what it came off, so the parent can list what is
-- no longer on it and the child can say where it came from.
alter table public.products add column if not exists parent_product_id uuid
  references public.products(id) on delete set null;

create index if not exists products_parent_idx
  on public.products (vendor_id, parent_product_id)
  where parent_product_id is not null;

-- The event: who removed what, when, and how much cost went with it. Kept apart
-- from the link because the link answers "what is missing now" while this
-- answers "what happened to this assembly", and a child that is later deleted
-- must not erase the record that a piece came off.
create table if not exists public.product_part_outs (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  parent_product_id uuid not null references public.products(id) on delete cascade,
  child_product_id uuid references public.products(id) on delete set null,
  description text not null,
  quantity integer not null default 1,
  -- Moved OUT of the parent and onto the child. Zero is legitimate: most of the
  -- current catalogue carries no cost to split.
  cost_assigned numeric not null default 0,
  parent_cost_before numeric,
  parent_cost_after numeric,
  notes text,
  removed_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists product_part_outs_parent_idx
  on public.product_part_outs (parent_product_id, created_at desc);
create index if not exists product_part_outs_vendor_idx
  on public.product_part_outs (vendor_id, created_at desc);

alter table public.product_part_outs enable row level security;

-- Reached only through the API's admin client, same as the other audit tables.
drop policy if exists "service role manages part outs" on public.product_part_outs;
create policy "service role manages part outs"
  on public.product_part_outs for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

select 'product_part_outs' as t, count(*) as rows from public.product_part_outs;
