-- ══════════════════════════════════════════════════════════════════════════════
-- Product Country of Manufacture
-- Adds an optional origin_country field to products (e.g. Japan, Thailand, China,
-- India, Indonesia). Used by WHEEL MART where country of make is a real buying
-- factor for tyres, but harmless/generic for every vendor.
-- Run in Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS origin_country TEXT;
