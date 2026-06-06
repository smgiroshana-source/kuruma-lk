-- ============================================================
-- WHEEL MART — Phase 5 Migration
-- Run in Supabase: Dashboard → SQL Editor → New Query
--
-- Adds:
--   1. foreign_currency, foreign_amount on grn_items
--      (record original JPY/USD/etc. alongside LKR cost)
--   2. reversed status support on grns
--      (reversed_at, allows GRN reversal workflow)
-- ============================================================

-- ── 1. Foreign currency columns on grn_items ─────────────────
ALTER TABLE grn_items
  ADD COLUMN IF NOT EXISTS foreign_currency TEXT,        -- e.g. 'JPY', 'USD'
  ADD COLUMN IF NOT EXISTS foreign_amount   NUMERIC(14,2); -- amount in foreign currency

-- ── 2. Reversed status on grns ───────────────────────────────
ALTER TABLE grns
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

-- The status column already exists as TEXT — just allow 'reversed'
-- (no constraint to change; the app enforces valid values)

-- ── VERIFY ───────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'grn_items' AND column_name IN ('foreign_currency','foreign_amount');
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'grns' AND column_name = 'reversed_at';
