-- ============================================================
-- WHEEL MART — Phase 4-B Migration
-- Run in Supabase: Dashboard → SQL Editor → New Query
--
-- Adds two Postgres functions for atomic FIFO cost layer management:
--   consume_fifo_cost() — deducts from oldest layers on sale
--   restore_fifo_cost() — re-adds a layer on void/return
-- ============================================================

-- ── consume_fifo_cost ─────────────────────────────────────────
-- Atomically deducts p_quantity units from the oldest cost layers
-- for a product, in received_at order (FIFO).
-- Returns the TOTAL cost consumed (whole LKR).
-- Caller divides by quantity to get unit_cost.
-- Returns 0 if no cost layers exist (product not yet in GRN system).
CREATE OR REPLACE FUNCTION consume_fifo_cost(
  p_vendor_id  UUID,
  p_product_id UUID,
  p_quantity   INTEGER
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_remaining  INTEGER := p_quantity;
  v_total_cost INTEGER := 0;
  v_take       INTEGER;
  v_layer      RECORD;
BEGIN
  FOR v_layer IN
    SELECT id, quantity_remaining, unit_cost
    FROM cost_layers
    WHERE vendor_id          = p_vendor_id
      AND product_id         = p_product_id
      AND quantity_remaining > 0
    ORDER BY received_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take       := LEAST(v_remaining, v_layer.quantity_remaining);
    UPDATE cost_layers
       SET quantity_remaining = quantity_remaining - v_take
     WHERE id = v_layer.id;
    v_total_cost := v_total_cost + (v_take * v_layer.unit_cost);
    v_remaining  := v_remaining  - v_take;
  END LOOP;
  RETURN v_total_cost;
END;
$$;

-- ── restore_fifo_cost ─────────────────────────────────────────
-- Inserts a new cost layer to restore stock on void or return.
-- Uses the original unit_cost from the sale_item — not perfectly
-- exact FIFO reversal, but correct for practical accounting.
CREATE OR REPLACE FUNCTION restore_fifo_cost(
  p_vendor_id   UUID,
  p_product_id  UUID,
  p_quantity    INTEGER,
  p_unit_cost   INTEGER,
  p_received_at DATE
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cost_layers
    (vendor_id, product_id, quantity_received, quantity_remaining, unit_cost, received_at)
  VALUES
    (p_vendor_id, p_product_id, p_quantity, p_quantity, p_unit_cost, p_received_at);
END;
$$;

-- ── VERIFY ───────────────────────────────────────────────────
-- SELECT proname FROM pg_proc WHERE proname IN ('consume_fifo_cost','restore_fifo_cost');
