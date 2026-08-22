-- ═══════════════════════════════════════════════════════════════════════════
-- WHEEL MART — clear all data, keep the setup
--
-- Owner request 2026-08-22: wipe the test data so real data can be entered.
--
-- SCOPE: vendor_id = 46f52c93-ee4b-4b28-bcd6-eb79ff11c503 (WHEEL MART) ONLY.
-- Sakura Auto Parts (0ae910a5-…) is NOT touched. Every statement below is
-- scoped either by that vendor_id directly or through a parent row that is.
--
-- KEPT: invoice_entities, vendor_staff (logins and roles), tax_config,
-- vendor_settings and vendor_transfer_links — the things that would have to be
-- reconfigured from scratch. Staff are NOT deleted; only their attendance and
-- payroll runs, which are transactions.
--
-- DELETED: every transaction, all products, all suppliers, all customers.
--
-- stock_transfers is deliberately NOT deleted. All 8 rows are Sakura → WHEEL
-- MART, so they are Sakura's outgoing history as much as WHEEL MART's incoming
-- record. Only the pointer to the deleted destination product is cleared.
--
-- Runs as one transaction: it either all happens or none of it does.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- Hold the vendor id once so no statement can drift onto the wrong shop
create temporary table _wm on commit drop as
  select '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'::uuid as id;

-- Guard: refuse to run if that is somehow not WHEEL MART
do $$
declare n text;
begin
  select name into n from public.vendors where id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503';
  if n is null or n not ilike '%MACFORCE%' then
    raise exception 'Vendor id does not resolve to MACFORCE (got %) — aborting', coalesce(n, 'NULL');
  end if;
end $$;

-- ── 1. Unlink transfers from products about to be deleted ─────────────────
-- Keeps Sakura's record of having sent them; drops only the FK that would
-- otherwise block the product delete.
update public.stock_transfers
   set to_product_id = null
 where to_product_id in (select id from public.products where vendor_id = (select id from _wm));

-- ── 2. Sales and everything hanging off them ──────────────────────────────
delete from public.credit_note_items where credit_note_id in
  (select id from public.credit_notes where vendor_id = (select id from _wm));
delete from public.credit_notes where vendor_id = (select id from _wm);

delete from public.payments where sale_id in
  (select id from public.sales where vendor_id = (select id from _wm));
delete from public.sale_items where sale_id in
  (select id from public.sales where vendor_id = (select id from _wm));
delete from public.invoice_promotion_log where vendor_id = (select id from _wm);
delete from public.sales where vendor_id = (select id from _wm);

-- ── 3. Purchasing: supplier side before the GRNs they reference ───────────
delete from public.supplier_credit_notes where vendor_id = (select id from _wm);
delete from public.supplier_payments    where vendor_id = (select id from _wm);
delete from public.supplier_invoices    where vendor_id = (select id from _wm);

delete from public.cost_layers where vendor_id = (select id from _wm);
delete from public.grn_items where grn_id in
  (select id from public.grns where vendor_id = (select id from _wm));
delete from public.grns where vendor_id = (select id from _wm);

-- ── 4. Stock events ───────────────────────────────────────────────────────
delete from public.stock_writeoff_items where writeoff_id in
  (select id from public.stock_writeoffs where vendor_id = (select id from _wm));
delete from public.stock_writeoffs where vendor_id = (select id from _wm);
delete from public.stock_movements  where vendor_id = (select id from _wm);
delete from public.import_vat_entries where vendor_id = (select id from _wm);

-- ── 4b. Payroll ───────────────────────────────────────────────────────────
-- Attendance and payroll runs are transactions, not setup. vendor_staff (the
-- logins and roles) is NOT touched — that is configuration.
delete from public.attendance   where vendor_id = (select id from _wm);
delete from public.payroll_runs where vendor_id = (select id from _wm);

-- ── 5. Cash and expenses ──────────────────────────────────────────────────
delete from public.cash_movements where vendor_id = (select id from _wm);
delete from public.cash_sessions  where vendor_id = (select id from _wm);
delete from public.expenses       where vendor_id = (select id from _wm);

-- ── 6. Master data ────────────────────────────────────────────────────────
delete from public.product_images where product_id in
  (select id from public.products where vendor_id = (select id from _wm));
delete from public.products  where vendor_id = (select id from _wm);
delete from public.suppliers where vendor_id = (select id from _wm);
delete from public.customers where vendor_id = (select id from _wm);

-- ── 7. Reset the serial counters ──────────────────────────────────────────
-- Scoped to WHEEL MART's own entities. Deleting the rows makes the next
-- invoice start at 1 again; next_invoice_serial re-creates them on demand.
delete from public.invoice_sequences where entity_id in
  (select id from public.invoice_entities where vendor_id = (select id from _wm));

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verify: WHEEL MART empty, setup intact, Sakura untouched
-- ═══════════════════════════════════════════════════════════════════════════
select 'sales'          as table_name, count(*) from public.sales     where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
union all select 'products',  count(*) from public.products  where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
union all select 'suppliers', count(*) from public.suppliers where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
union all select 'customers', count(*) from public.customers where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
union all select 'grns',      count(*) from public.grns      where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
union all select 'expenses',  count(*) from public.expenses  where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
union all select '-- KEPT: entities', count(*) from public.invoice_entities where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
union all select '-- KEPT: staff',    count(*) from public.vendor_staff     where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
union all select '-- KEPT: tax_config', count(*) from public.tax_config     where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
union all select '** SAKURA products (must stay 7266)', count(*) from public.products where vendor_id = '0ae910a5-da00-4e1a-9bf2-7245b825cf90'
union all select '** SAKURA sales (must be unchanged)', count(*) from public.sales    where vendor_id = '0ae910a5-da00-4e1a-9bf2-7245b825cf90'
union all select '** transfers kept (should be 8)',     count(*) from public.stock_transfers;
