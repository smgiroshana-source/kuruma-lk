-- ============================================================
-- WHEEL MART — Phase 7 Migration
-- Run in Supabase: Dashboard → SQL Editor → New Query
--
-- Adds supplier_tin and supplier_vat_registered to grns so that:
--   • The input VAT report can show which GRNs have a claimable
--     tax invoice (VAT-registered supplier with a valid TIN)
--   • The VAT Summary only counts input VAT from VAT-registered
--     suppliers — preventing overclaiming on IRD returns
--
-- Existing GRNs will have NULL in both columns (legacy rows).
-- The app treats NULL as "unknown / pre-fix" and includes them
-- in totals with a warning — the accountant verifies manually.
-- ============================================================

ALTER TABLE grns
  ADD COLUMN IF NOT EXISTS supplier_tin             TEXT,        -- snapshotted from suppliers.tin
  ADD COLUMN IF NOT EXISTS supplier_vat_registered  BOOLEAN;     -- snapshotted from suppliers.vat_registered
                                                                  -- NULL = legacy GRN (created before this column)

-- ── OPTIONAL: back-fill existing GRNs from the suppliers table ───────────────
-- Uncomment and run AFTER the ALTER above if you want to populate existing rows.
-- Safe to run multiple times (only updates rows where supplier_id is set).
--
-- UPDATE grns g
-- SET
--   supplier_tin            = s.tin,
--   supplier_vat_registered = s.vat_registered
-- FROM suppliers s
-- WHERE g.supplier_id = s.id
--   AND g.supplier_tin IS NULL;

-- ── VERIFY ───────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type
-- FROM   information_schema.columns
-- WHERE  table_name = 'grns'
--   AND  column_name IN ('supplier_tin', 'supplier_vat_registered');
