-- ═══════════════════════════════════════════════════════════════════════════
-- Accessories & consumables (WHEEL MART)
--
-- The shop sells more than tyres: tubes, flaps, tubeless valves/patches,
-- tube patches, sticker & clip weights. Tubes and flaps are countable units
-- and behave like any part. The small consumables are LOOSE-COUNTED
-- (owner, 2026-08-25): the count is approximate, kept "as well as possible",
-- and a NEGATIVE count is information — it says the book count is off by at
-- least that much — not an error to clamp away.
--
-- 1. adjust_product_quantity: consumables (product_type = 'consumable') may
--    go below zero; everything else keeps the existing floor at 0.
-- 2. GRN lines can record pack purchases: 2 packs × 24 pieces lands 48
--    pieces with the per-piece cost, and the pack fact is kept for audit.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION adjust_product_quantity(
  p_product_id uuid,
  p_vendor_id  uuid,
  p_delta      integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_qty integer;
  v_type    text;
BEGIN
  SELECT product_type INTO v_type FROM products
   WHERE id = p_product_id AND vendor_id = p_vendor_id;

  IF v_type IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE products
     SET quantity = CASE
       WHEN v_type = 'consumable' THEN quantity + p_delta
       ELSE GREATEST(0, quantity + p_delta)
     END
   WHERE id = p_product_id
     AND vendor_id = p_vendor_id
  RETURNING quantity INTO v_new_qty;

  RETURN v_new_qty;
END;
$$;

REVOKE ALL ON FUNCTION adjust_product_quantity(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adjust_product_quantity(uuid, uuid, integer) TO service_role;

-- Pack purchases on GRN lines — display/audit only; quantity stays pieces.
alter table public.grn_items add column if not exists packs integer;
alter table public.grn_items add column if not exists pieces_per_pack integer;

-- ── Verify ──
select 'adjust_product_quantity' as item,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'adjust_product_quantity') as ok
union all
select 'grn_items.packs', (select count(*) from information_schema.columns
  where table_name = 'grn_items' and column_name = 'packs');
