-- ═══════════════════════════════════════════════════════════════════════════
-- WHEEL MART — clear all data, keep the logins and the setup
--
-- SCOPE: vendor_id 46f52c93-… (WHEEL MART) only. Sakura is NOT touched.
--
-- KEPT: vendor_staff (logins/roles), invoice_entities, tax_config,
--       vendor_settings, vendor_transfer_links, and all 8 stock_transfers
--       (they are Sakura's outgoing history as much as ours).
--
-- DELETED: every transaction, all products, suppliers, customers, and the
--          employee records with their pay structure. Serial counters reset.
--
-- Delete order follows the live foreign-key map, read from the schema rather
-- than guessed — notably expenses before cash_sessions
-- (expenses.cash_session_id), and everything pointing at employees before
-- employees themselves.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create temporary table _wm on commit drop as
  select '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'::uuid as id;

do $$
declare n text;
begin
  select name into n from public.vendors
   where id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503';
  if n is null or n not ilike '%MACFORCE%' then
    raise exception 'Not MACFORCE (got %) - aborting', coalesce(n,'NULL');
  end if;
end $$;

-- Transfers Sakura SENT us: keep the row (it is their outgoing history),
-- clear only the pointer to the destination product being deleted.
update public.stock_transfers set to_product_id = null
 where to_product_id in
   (select id from public.products where vendor_id = (select id from _wm));

-- Transfers WE sent Sakura: from_product_id is NOT NULL, so the row cannot
-- survive its source product. One row today, the WM -> Sakura "test transfer".
-- The product Sakura created by accepting it is theirs and is unaffected.
delete from public.stock_transfers
 where from_product_id in
   (select id from public.products where vendor_id = (select id from _wm));

delete from public.credit_note_items where credit_note_id in
  (select id from public.credit_notes where vendor_id = (select id from _wm));
delete from public.credit_notes where vendor_id = (select id from _wm);
delete from public.payments where sale_id in
  (select id from public.sales where vendor_id = (select id from _wm));
delete from public.sale_items where sale_id in
  (select id from public.sales where vendor_id = (select id from _wm));
delete from public.invoice_promotion_log where vendor_id = (select id from _wm);
delete from public.sales where vendor_id = (select id from _wm);

delete from public.supplier_credit_notes where vendor_id = (select id from _wm);
delete from public.supplier_payments where vendor_id = (select id from _wm);
delete from public.supplier_invoices where vendor_id = (select id from _wm);
delete from public.supplier_return_items where return_id in
  (select id from public.supplier_returns where vendor_id = (select id from _wm));
delete from public.supplier_returns where vendor_id = (select id from _wm);

delete from public.cost_layers where vendor_id = (select id from _wm);
delete from public.grn_items where grn_id in
  (select id from public.grns where vendor_id = (select id from _wm));
delete from public.grns where vendor_id = (select id from _wm);

delete from public.stock_writeoff_items where writeoff_id in
  (select id from public.stock_writeoffs where vendor_id = (select id from _wm));
delete from public.stock_writeoffs where vendor_id = (select id from _wm);
delete from public.stock_movements where vendor_id = (select id from _wm);
delete from public.import_vat_entries where vendor_id = (select id from _wm);

delete from public.payroll_lines where run_id in
  (select id from public.payroll_runs where vendor_id = (select id from _wm));
delete from public.payroll_runs where vendor_id = (select id from _wm);
delete from public.staff_attendance where employee_id in
  (select id from public.employees where vendor_id = (select id from _wm));
delete from public.staff_advances where vendor_id = (select id from _wm);
delete from public.staff_audit where vendor_id = (select id from _wm);
delete from public.employee_pay_items where employee_id in
  (select id from public.employees where vendor_id = (select id from _wm));
delete from public.employees where vendor_id = (select id from _wm);

delete from public.expenses where vendor_id = (select id from _wm);
delete from public.cash_corrections where vendor_id = (select id from _wm);
delete from public.cash_movements where vendor_id = (select id from _wm);
delete from public.cash_sessions where vendor_id = (select id from _wm);

delete from public.product_images where product_id in
  (select id from public.products where vendor_id = (select id from _wm));
delete from public.customer_vehicles where vendor_id = (select id from _wm);
delete from public.fleet_accounts where vendor_id = (select id from _wm);
delete from public.products where vendor_id = (select id from _wm);
delete from public.suppliers where vendor_id = (select id from _wm);
delete from public.customers where vendor_id = (select id from _wm);

delete from public.invoice_sequences where entity_id in
  (select id from public.invoice_entities where vendor_id = (select id from _wm));
delete from public.grn_sequences where vendor_id = (select id from _wm);
delete from public.vendor_sequences where vendor_id = (select id from _wm);

commit;
