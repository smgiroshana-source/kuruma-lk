-- WHEEL MART Phase 8: atomic stock adjustment
-- Run in Supabase SQL editor.
--
-- Replaces the read-then-write stock updates in the API routes with a single
-- atomic UPDATE so concurrent sales/GRNs/returns can't lose increments.
-- Quantity is clamped at 0 (matches previous Math.max(0, ...) behaviour).

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
BEGIN
  UPDATE products
     SET quantity = GREATEST(0, quantity + p_delta)
   WHERE id = p_product_id
     AND vendor_id = p_vendor_id
  RETURNING quantity INTO v_new_qty;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_new_qty;
END;
$$;

REVOKE ALL ON FUNCTION adjust_product_quantity(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adjust_product_quantity(uuid, uuid, integer) TO service_role;
