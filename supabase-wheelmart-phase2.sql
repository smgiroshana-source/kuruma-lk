-- ============================================================
-- WHEEL MART — Phase 2 Migration
-- Run in Supabase: Dashboard → SQL Editor → New Query
--
-- Adds two columns to `sales` so a tax invoice can snapshot
-- the purchaser's address + TIN at the moment of issue.
-- These are lk_tax-only fields; NULL for all other vendors.
-- ============================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS customer_address  TEXT,  -- purchaser address (required on tax invoice)
  ADD COLUMN IF NOT EXISTS customer_tin      TEXT;  -- purchaser TIN (only if purchaser is VAT-registered)

-- ── VERIFY ───────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'sales'
--    AND column_name IN ('customer_address', 'customer_tin');
