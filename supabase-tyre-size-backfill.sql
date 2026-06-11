-- ══════════════════════════════════════════════════════════════════════════════
-- Backfill tyre_width / tyre_profile / tyre_rim for EXISTING products
-- by parsing the standard radial size (e.g. 185/65R15) out of the product name.
--
-- Self-scoping: only rows whose name contains a real tyre-size pattern are
-- touched, so non-tyre products (and other vendors' parts) are untouched.
-- Idempotent: only fills rows where tyre_width is still NULL.
-- Run in the Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE products p
SET
  tyre_width   = (m[1])::smallint,
  tyre_profile = (m[2])::smallint,
  tyre_rim     = (m[3])::smallint,
  product_type = 'tyre'
FROM (
  SELECT id, regexp_match(name, '(\d{3})/(\d{2})[Rr] ?(\d{1,2})') AS m
  FROM products
) s
WHERE p.id = s.id
  AND s.m IS NOT NULL
  AND p.tyre_width IS NULL;

-- Check the result:
--   SELECT count(*) FROM products WHERE product_type = 'tyre' AND tyre_width IS NOT NULL;
