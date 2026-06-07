-- ══════════════════════════════════════════════════════════════════════════════
-- WHEEL MART — Tyre & Auto Parts Optimisation
-- Run in Supabase SQL editor
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Add product_type enum and tyre-specific size fields to products
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'part',
  ADD COLUMN IF NOT EXISTS tyre_width   SMALLINT,   -- e.g. 185
  ADD COLUMN IF NOT EXISTS tyre_profile SMALLINT,   -- e.g. 65
  ADD COLUMN IF NOT EXISTS tyre_rim     SMALLINT;   -- e.g. 15

-- 2. Mark existing Wheels & Tires products as tyre type
UPDATE products
SET product_type = 'tyre'
WHERE category = 'Wheels & Tires'
  AND product_type = 'part';

-- 3. Index for fast tyre-size search in POS
CREATE INDEX IF NOT EXISTS idx_products_tyre_size
  ON products (vendor_id, tyre_width, tyre_profile, tyre_rim)
  WHERE product_type = 'tyre';
