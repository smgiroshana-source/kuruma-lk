-- ═══════════════════════════════════════════════════════════════════════════
-- Money-in quick items are chosen in Products (owner, 2026-09-07)
--
-- The chips in "Money in — no invoice" were a fixed list in code, bound to
-- products by name. Adding a flap meant a code change. Now any product can
-- be switched on from the Products list and it appears as a chip, with its
-- price and its stock link. The eight parts the code used to name are
-- switched on here so nothing disappears; the four flaps join them.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists show_in_money_in boolean not null default false;

create index if not exists idx_products_money_in
  on public.products (vendor_id) where show_in_money_in;

-- WHEEL MART = 46f52c93-ee4b-4b28-bcd6-eb79ff11c503
update public.products
   set show_in_money_in = true
 where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
   and (
     lower(name) in ('tubeless valve', 'tubeless patch', 'tubeless nickel valve', 'tube patch',
                     'wheel nut', 'camber shim', 'sticker weight', 'clip weight',
                     '400r 8 flap', '20 flap', '15 flap', '16 flap',
                     'cable tie 10"', 'cable tie 12"')
   );

-- ── Verify ──
select name, sku, product_type, price, quantity, show_in_money_in
  from public.products
 where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503' and show_in_money_in
 order by product_type, name;
