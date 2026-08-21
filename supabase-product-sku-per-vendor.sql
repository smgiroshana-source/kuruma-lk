-- ─────────────────────────────────────────────────────────────────────────────
-- products.sku: unique PER VENDOR, not across the whole marketplace
--
-- `products_sku_key` is a leftover from when this database held one shop. It
-- makes a SKU unique across every vendor at once, which on a marketplace is
-- simply the wrong rule: a part number belongs to the manufacturer, so Sakura
-- and WHEEL MART selling the same Bridgestone tyre must be able to use the
-- same code for it. Two things it broke:
--
--   1. INTER-VENDOR STOCK TRANSFER — never worked, not once. Sending a product
--      to another shop creates it there with the same SKU, while the sending
--      shop still holds that SKU. Under a global unique index that insert can
--      never succeed, so every transfer of a not-yet-shared product failed on
--      "duplicate key value violates unique constraint products_sku_key" and
--      the stock_transfers table stayed empty. The matching branch — "SKU
--      already exists at destination, top it up" — was unreachable for the
--      same reason: a global unique index means no two vendors can ever hold
--      the same SKU, so the destination could never already have it.
--
--   2. BULK UPLOAD — a CSV row whose SKU another vendor happens to use is
--      rejected by the database, even though this vendor has never used it.
--      The pre-check only looks within the vendor, so the row looks fine right
--      up until the insert.
--
-- Safe to change: every SKU lookup in the app already filters by vendor_id
-- (stock-transfer destination match, bulk_check_skus, bulk_create), so nothing
-- relies on a SKU being globally resolvable.
--
-- NULL skus stay unrestricted — SQL treats NULLs as distinct, so any number of
-- products may have no SKU, exactly as before.
-- ─────────────────────────────────────────────────────────────────────────────

-- Nothing should collide today (a global unique index guaranteed that), but
-- check before dropping the guard rather than after.
select vendor_id, sku, count(*)
from public.products
where sku is not null
group by vendor_id, sku
having count(*) > 1;

alter table public.products drop constraint if exists products_sku_key;
drop index if exists public.products_sku_key;

alter table public.products
  add constraint products_vendor_sku_key unique (vendor_id, sku);

comment on constraint products_vendor_sku_key on public.products is
  'A SKU identifies a product within one vendor. Different vendors may use the same manufacturer part number.';

-- Confirm: the per-vendor rule is in place and the global one is gone
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.products'::regclass
  and conname in ('products_sku_key', 'products_vendor_sku_key');
