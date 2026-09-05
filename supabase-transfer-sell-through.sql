-- ═══════════════════════════════════════════════════════════════════════════
-- Transfer sell-through (owner, 2026-09-05)
--
-- Sakura moves a part to WHEEL MART with a transfer cost — say a hybrid
-- battery at Rs.250,000. Sakura does not book anything at that moment: the
-- part has only changed shelves. When WHEEL MART actually SELLS it, Sakura
-- has sold it too — to WHEEL MART, at the transfer cost, on that day. So the
-- app raises a real Sakura sale (credit, to the customer that stands for the
-- receiving shop) dated the same day as the WHEEL MART sale. It then appears
-- in Sakura's daily report, the period Sales Report, the customer's ledger
-- and any commission run without special report logic.
--
-- Only transfers that carry a transfer_cost take part. A transfer sent with
-- the cost blank is a plain stock move, as before.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- How many of the transferred units the receiving shop has sold so far. The
-- cap: a receiving shop that already stocked the SKU can sell more units than
-- were transferred, and only the transferred ones are Sakura's to bill.
alter table public.stock_transfers
  add column if not exists sold_through_quantity integer not null default 0;

alter table public.stock_transfers
  drop constraint if exists stock_transfers_sold_through_check;
alter table public.stock_transfers
  add constraint stock_transfers_sold_through_check
  check (sold_through_quantity >= 0 and sold_through_quantity <= quantity);

-- The sale at the receiving shop that caused this one. Set only on the
-- source shop's auto-raised sale; null on every ordinary sale.
alter table public.sales
  add column if not exists sell_through_of_sale_id uuid references public.sales(id);

create index if not exists idx_sales_sell_through_of
  on public.sales (sell_through_of_sale_id)
  where sell_through_of_sale_id is not null;

-- Each auto-raised line remembers the transfer it draws down and the line at
-- the receiving shop it mirrors, so a void or return there can be mirrored
-- back precisely.
alter table public.sale_items
  add column if not exists sell_through_transfer_id uuid references public.stock_transfers(id),
  add column if not exists sell_through_of_item_id  uuid references public.sale_items(id);

create index if not exists idx_sale_items_sell_through_of
  on public.sale_items (sell_through_of_item_id)
  where sell_through_of_item_id is not null;

-- Which customer row stands for the receiving shop AS A VENDOR, in the source
-- shop's books. A dedicated row, never one of the shop's real accounts: Sakura
-- bills "Macforce Auto Engineering" (the workshop) on credit and has a
-- "Wheel Mart. Thalawathugoda" account with a genuine purchase — the owner
-- wants neither touched (2026-09-05). Sold-on records carry no money, so they
-- get their own home.
alter table public.customers
  add column if not exists linked_vendor_id uuid references public.vendors(id);

create index if not exists idx_customers_linked_vendor
  on public.customers (vendor_id, linked_vendor_id)
  where linked_vendor_id is not null;

-- Sakura Auto Parts = 0ae910a5-da00-4e1a-9bf2-7245b825cf90
-- WHEEL MART        = 46f52c93-ee4b-4b28-bcd6-eb79ff11c503

-- An earlier version of this file linked the workshop's credit account. Undo
-- that if it happened; the real ledger must stay as it was.
update public.customers
   set linked_vendor_id = null
 where vendor_id = '0ae910a5-da00-4e1a-9bf2-7245b825cf90'
   and linked_vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
   and name <> 'WHEEL MART (sold on)';

-- The dedicated customer, created once.
insert into public.customers (vendor_id, name, linked_vendor_id)
select '0ae910a5-da00-4e1a-9bf2-7245b825cf90', 'WHEEL MART (sold on)', '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
 where not exists (
   select 1 from public.customers
    where vendor_id = '0ae910a5-da00-4e1a-9bf2-7245b825cf90'
      and linked_vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
 );

-- ── Verify: exactly one row, named WHEEL MART (sold on); Macforce unlinked ──
select id, name, phone, linked_vendor_id
  from public.customers
 where vendor_id = '0ae910a5-da00-4e1a-9bf2-7245b825cf90'
   and (linked_vendor_id is not null or lower(name) like 'macforce auto%');
