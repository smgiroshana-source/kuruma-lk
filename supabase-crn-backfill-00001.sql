-- ============================================================
-- BACKFILL: Create CRN credit note for return against 26JUN_PART_00001
-- Run ONCE in Supabase: Dashboard → SQL Editor → New Query
--
-- This inserts ONLY the credit_notes / credit_note_items records.
-- Stock restoration and returned_amount on the sale were already
-- handled by the old return_items flow — do NOT touch those here.
-- ============================================================

DO $$
DECLARE
  v_sale          RECORD;
  v_entity_id     UUID;
  v_next_seq      BIGINT;
  v_crn_no        TEXT;
  v_cn_id         UUID;
  v_total         INTEGER := 0;
  v_vat_rate      NUMERIC := 18;
  v_vat_amount    INTEGER;
  v_net_amount    INTEGER;
  v_return_date   TIMESTAMPTZ;
BEGIN

  -- ── 1. Fetch the original sale ──────────────────────────────
  SELECT s.id, s.vendor_id, s.invoice_entity_id,
         s.customer_name, s.customer_address, s.customer_tin,
         s.voided_at, s.created_at
  INTO   v_sale
  FROM   sales s
  WHERE  s.tax_serial = '26JUN_PART_00001'
  LIMIT  1;

  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Sale with tax_serial = 26JUN_PART_00001 not found';
  END IF;

  v_entity_id  := v_sale.invoice_entity_id;
  -- Use voided_at as the credit note date; fall back to today
  v_return_date := COALESCE(v_sale.voided_at, NOW());

  -- ── 2. Bail if a CRN already exists for this sale ───────────
  IF EXISTS (SELECT 1 FROM credit_notes WHERE original_sale_id = v_sale.id) THEN
    RAISE EXCEPTION 'A credit note already exists for sale %. Aborting.', v_sale.id;
  END IF;

  -- ── 3. Sum the returned line amounts ────────────────────────
  SELECT COALESCE(SUM(si.returned_quantity * si.unit_price::NUMERIC), 0)
  INTO   v_total
  FROM   sale_items si
  WHERE  si.sale_id = v_sale.id
    AND  si.returned_quantity > 0;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'No returned items found on sale %. Check sale_items.returned_quantity.', v_sale.id;
  END IF;

  v_vat_amount := ROUND(v_total * v_vat_rate / (100 + v_vat_rate))::INTEGER;
  v_net_amount := v_total::INTEGER - v_vat_amount;

  -- ── 4. Reserve next CRN sequence via the existing RPC ───────
  -- next_invoice_serial(entity_id, period) → integer
  SELECT next_invoice_serial(v_entity_id, 'credit') INTO v_next_seq;
  v_crn_no := 'CRN-' || LPAD(v_next_seq::TEXT, 5, '0');

  -- ── 5. Insert credit note header ────────────────────────────
  INSERT INTO credit_notes (
    vendor_id, invoice_entity_id,
    original_sale_id, original_serial,
    credit_note_no, reason,
    customer_name, customer_address, customer_tin,
    net_amount, vat_amount, total,
    issued_at
  ) VALUES (
    v_sale.vendor_id, v_entity_id,
    v_sale.id, '26JUN_PART_00001',
    v_crn_no, 'goods_returned',
    v_sale.customer_name, v_sale.customer_address, v_sale.customer_tin,
    v_net_amount, v_vat_amount, v_total::INTEGER,
    v_return_date
  )
  RETURNING id INTO v_cn_id;

  -- ── 6. Insert credit note line items ────────────────────────
  INSERT INTO credit_note_items (
    credit_note_id, original_item_id,
    product_name, quantity, unit_price, total, sscl_stream
  )
  SELECT
    v_cn_id,
    si.id,
    si.product_name,
    si.returned_quantity,
    si.unit_price::INTEGER,
    (si.returned_quantity * si.unit_price::NUMERIC)::INTEGER,
    COALESCE(si.sscl_stream, 'PART')
  FROM sale_items si
  WHERE si.sale_id = v_sale.id
    AND si.returned_quantity > 0;

  -- ── 7. Report result ─────────────────────────────────────────
  RAISE NOTICE
    'Created % | Total: Rs.% | VAT: Rs.% | Net: Rs.% | Dated: %',
    v_crn_no, v_total, v_vat_amount, v_net_amount, v_return_date;

END $$;

-- ── VERIFY ───────────────────────────────────────────────────
-- Run this after the DO block to confirm the CRN was created:
SELECT cn.credit_note_no, cn.original_serial, cn.total,
       cn.vat_amount, cn.net_amount, cn.issued_at,
       cn.customer_name,
       COUNT(ci.id) AS line_items
FROM   credit_notes cn
LEFT   JOIN credit_note_items ci ON ci.credit_note_id = cn.id
WHERE  cn.original_serial = '26JUN_PART_00001'
GROUP  BY cn.id, cn.credit_note_no, cn.original_serial, cn.total,
          cn.vat_amount, cn.net_amount, cn.issued_at, cn.customer_name;
