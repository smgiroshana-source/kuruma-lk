-- ============================================================
-- Security check 2026-11-04 — app-only database functions
-- Run once in the Supabase SQL Editor.
--
-- Postgres lets EVERYONE run a new function unless that right is taken away,
-- and the public (anon) key is in every visitor's browser. Tested with that
-- key on 2026-11-04:
--   next_vendor_seq          RAN — it issues Sakura's SAK- invoice and
--                            SAK-OP- draft numbers. Shop ids are public
--                            (storefront feed), so anyone could burn numbers
--                            and leave gaps in the series.
--   get_top_searches etc.    RAN — anyone could read what customers search.
--   consume/restore_fifo_cost, next_invoice_serial, next_grn_serial
--                            ran, stopped only by table permissions.
--
-- The app calls all of these from the server with the service-role key, so
-- nothing changes for staff. Workshop Pulse calls none of them directly.
-- The wp_is_* helpers (Workshop Pulse permission rules) are left alone.
-- ============================================================

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'next_vendor_seq', 'next_invoice_serial', 'next_grn_serial', 'next_grn_series_serial',
         'adjust_product_quantity', 'consume_fifo_cost', 'restore_fifo_cost', 'sync_card_fee',
         'get_top_searches', 'get_zero_result_searches', 'get_top_makes', 'get_top_categories',
         'get_daily_search_volume'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;

-- Check: every row should read  anon=false, authenticated=false, service_role=true
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN (
     'next_vendor_seq', 'next_invoice_serial', 'next_grn_serial', 'next_grn_series_serial',
     'adjust_product_quantity', 'consume_fifo_cost', 'restore_fifo_cost', 'sync_card_fee',
     'get_top_searches', 'get_zero_result_searches', 'get_top_makes', 'get_top_categories',
     'get_daily_search_volume'
   )
 ORDER BY 1;
