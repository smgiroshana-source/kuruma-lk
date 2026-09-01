-- ═══════════════════════════════════════════════════════════════════════════
-- Correcting a wrong SKU on a finalised sale (owner, 2026-09-01)
--
-- A staff member picked the wrong SKU, and the system had no way to fix it.
-- So he returned the item and re-billed the right one — then backdated the
-- re-bill to keep the original day's figures looking tidy. Stock and the
-- customer's balance came out correct, but a closed day was rewritten and the
-- trail was indistinguishable from someone hiding something.
--
-- He improvised because the honest operation did not exist. This is it: swap
-- the SKU in place, move the stock, leave the date, quantity and price alone.
--
-- Every correction is recorded here. It is the point of the feature — an
-- in-place edit with no record would be worse than the workaround it replaces.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.sale_item_corrections (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  sale_item_id uuid not null,
  from_product_id uuid,
  from_sku text,
  from_name text,
  to_product_id uuid,
  to_sku text,
  to_name text,
  quantity integer not null,
  unit_price integer,
  reason text,
  corrected_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists sale_item_corrections_vendor_idx
  on public.sale_item_corrections (vendor_id, created_at desc);
create index if not exists sale_item_corrections_sale_idx
  on public.sale_item_corrections (sale_id);

alter table public.sale_item_corrections enable row level security;

-- Reached only through the API's admin client, same as the other audit tables.
drop policy if exists "service role manages item corrections" on public.sale_item_corrections;
create policy "service role manages item corrections"
  on public.sale_item_corrections for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

select 'sale_item_corrections' as t, count(*) from public.sale_item_corrections;
