-- ══════════════════════════════════════════════════════════════════════════════
-- MIGRATION STATUS CHECK
-- Run in Supabase SQL Editor — shows ✅ DONE or ❌ MISSING for everything
-- ══════════════════════════════════════════════════════════════════════════════

SELECT '══ FILE 1: supabase-wheelmart-tyre.sql ══' AS section, '' AS status

UNION ALL

-- products columns (tyre migration)
SELECT col, CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'products' AND column_name = col
) THEN '✅ EXISTS' ELSE '❌ MISSING' END
FROM (VALUES
  ('product_type'),
  ('tyre_width'),
  ('tyre_profile'),
  ('tyre_rim')
) AS t(col)

UNION ALL SELECT '── index: idx_products_tyre_size', CASE WHEN EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_products_tyre_size'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '', ''
UNION ALL SELECT '══ FILE 2: supabase-stock-transfer.sql ══', ''

UNION ALL SELECT '── table: stock_transfers', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'stock_transfers'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '── index: idx_stock_transfers_from', CASE WHEN EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_stock_transfers_from'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '── index: idx_stock_transfers_to', CASE WHEN EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_stock_transfers_to'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '', ''
UNION ALL SELECT '══ FILE 3: supabase-phases-1-8.sql ══', ''
UNION ALL SELECT '── PHASE 1 ──', ''

UNION ALL SELECT '   column products.min_stock_level', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'min_stock_level'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   table: stock_movements', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'stock_movements'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   index: idx_stock_movements_product', CASE WHEN EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_stock_movements_product'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   index: idx_stock_movements_recent', CASE WHEN EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_stock_movements_recent'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '── PHASE 2 ──', ''

UNION ALL SELECT col, CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = col
) THEN '✅ EXISTS' ELSE '❌ MISSING' END
FROM (VALUES
  ('   column suppliers.address'),
  ('   column suppliers.payment_terms'),
  ('   column suppliers.notes'),
  ('   column suppliers.is_active'),
  ('   column suppliers.created_at')
) AS t(col)

UNION ALL SELECT '   table: supplier_invoices', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'supplier_invoices'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   table: supplier_payments', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'supplier_payments'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   index: idx_supplier_invoices_due', CASE WHEN EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_supplier_invoices_due'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   index: idx_supplier_payments_date', CASE WHEN EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_supplier_payments_date'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '── PHASE 3 ──', ''

UNION ALL SELECT '   table: supplier_returns', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'supplier_returns'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   table: supplier_return_items', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'supplier_return_items'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '── PHASE 4 ──', ''

UNION ALL SELECT '   column sale_items.return_reason', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sale_items' AND column_name = 'return_reason'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '── PHASE 5 ──', ''

UNION ALL SELECT '   table: stock_writeoffs', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'stock_writeoffs'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   table: stock_writeoff_items', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'stock_writeoff_items'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '── PHASE 6 ──', ''

UNION ALL SELECT '   table: fleet_accounts', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'fleet_accounts'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   table: customer_vehicles', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'customer_vehicles'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   index: idx_fleet_vendor', CASE WHEN EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_fleet_vendor'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   index: idx_vehicles_plate', CASE WHEN EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_vehicles_plate'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '── PHASE 7 ──', ''

UNION ALL SELECT '   table: cash_sessions', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'cash_sessions'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   table: expenses', CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'expenses'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   index: idx_cash_sessions_date', CASE WHEN EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_cash_sessions_date'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '   index: idx_expenses_date', CASE WHEN EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_expenses_date'
) THEN '✅ EXISTS' ELSE '❌ MISSING' END

UNION ALL SELECT '', ''
UNION ALL SELECT '══ SUMMARY ══', ''

UNION ALL SELECT
  'Total missing: ' || COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN '🎉 All migrations applied!' ELSE '⚠️ Run missing files above' END
FROM (
  -- re-check everything and count only MISSING
  SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='product_type')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='tyre_width')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='tyre_profile')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='tyre_rim')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='stock_transfers')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='min_stock_level')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='stock_movements')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suppliers' AND column_name='payment_terms')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='supplier_invoices')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='supplier_payments')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='supplier_returns')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='supplier_return_items')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sale_items' AND column_name='return_reason')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='stock_writeoffs')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='stock_writeoff_items')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='fleet_accounts')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customer_vehicles')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cash_sessions')
  UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='expenses')
) missing;
