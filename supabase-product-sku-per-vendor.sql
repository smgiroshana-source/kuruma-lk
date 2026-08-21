-- ─────────────────────────────────────────────────────────────────────────────
-- products.sku: unique PER VENDOR, not across the whole marketplace
--
-- The global unique rule on sku is a leftover from when this database held one
-- shop. On a marketplace it is simply wrong: a part number belongs to the
-- manufacturer, so Sakura and WHEEL MART selling the same Bridgestone tyre
-- must be able to use the same code. Two things it breaks:
--
--   1. INTER-VENDOR STOCK TRANSFER — never worked, not once. Sending a product
--      creates it at the destination with the same SKU while the sending shop
--      still holds that SKU, so the insert can never succeed. stock_transfers
--      is empty. The "destination already has this SKU, top it up" branch was
--      unreachable for the same reason: under a global unique rule no two
--      vendors can ever hold the same SKU.
--
--   2. BULK UPLOAD — a CSV row whose SKU another vendor happens to use is
--      rejected by the database even though this vendor has never used it.
--      The pre-check only looks within the vendor, so the row looks fine right
--      up until the insert.
--
-- Safe: every SKU lookup in the app already filters by vendor_id, so nothing
-- relies on a SKU being globally resolvable. NULL skus stay unrestricted —
-- SQL treats NULLs as distinct.
--
-- Written to be re-runnable, and to drop the old rule by SHAPE rather than by
-- name — a `drop constraint if exists products_sku_key` silently succeeds and
-- changes nothing if the index turns out to be named something else, leaving
-- you with the same failure and no clue why.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  -- Any unique constraint or index whose key is exactly (sku) — whatever it's
  -- called. The per-vendor one is (vendor_id, sku), so it is never matched.
  for r in
    select i.indexrelid::regclass::text as idx,
           c.conname                    as constraint_name
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    left join pg_constraint c on c.conindid = i.indexrelid
    where t.oid = 'public.products'::regclass
      and i.indisunique
      and i.indnkeyatts = 1
      and (select attname from pg_attribute
           where attrelid = t.oid and attnum = i.indkey[0]) = 'sku'
  loop
    if r.constraint_name is not null then
      raise notice 'Dropping marketplace-wide unique CONSTRAINT %', r.constraint_name;
      execute format('alter table public.products drop constraint %I', r.constraint_name);
    else
      raise notice 'Dropping marketplace-wide unique INDEX %', r.idx;
      execute format('drop index %s', r.idx);
    end if;
  end loop;
end $$;

-- Nothing should collide (the global rule guaranteed it), but a duplicate here
-- would make the next statement fail with a confusing error, so surface it.
select vendor_id, sku, count(*) as copies
from public.products
where sku is not null
group by vendor_id, sku
having count(*) > 1;

alter table public.products
  drop constraint if exists products_vendor_sku_key;

alter table public.products
  add constraint products_vendor_sku_key unique (vendor_id, sku);

comment on constraint products_vendor_sku_key on public.products is
  'A SKU identifies a product within one vendor. Different vendors may use the same manufacturer part number.';

-- ── Verify ──
-- Expect exactly one row: products_vendor_sku_key / UNIQUE (vendor_id, sku).
-- If any row shows UNIQUE (sku) on its own, the old rule is still in force and
-- transfers will keep failing.
select c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = 'public.products'::regclass
  and c.contype = 'u'
order by c.conname;
