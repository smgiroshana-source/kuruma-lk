-- ─────────────────────────────────────────────────────────────────────────────
-- Canonical supplier-payment methods: cash / online / cheque
--
-- Rows were stored with UI labels ('Cash', 'Bank Transfer', 'Card'), so the
-- drawer arithmetic — which matches lowercase 'cash' — never saw cash supplier
-- payments. Normalize what exists; the API now stores canonical values only.
-- ─────────────────────────────────────────────────────────────────────────────

update public.supplier_payments set method = 'cash'   where lower(method) = 'cash';
update public.supplier_payments set method = 'cheque' where lower(method) like '%cheque%';
update public.supplier_payments set method = 'online'
 where lower(method) like '%bank%' or lower(method) = 'card' or lower(method) = 'online';

select method, count(*) from public.supplier_payments group by method;
