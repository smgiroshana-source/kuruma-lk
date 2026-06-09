-- ============================================================
-- Promote RCP-00001 → gazette tax invoice 26JUN_PART_00003
-- Run in Supabase: Dashboard → SQL Editor → New Query
--
-- This sale was created before the always-tax-invoice rule.
-- We assign the next gazette serial and update document_type,
-- net_amount, and vat_amount to make it a proper tax invoice.
-- ============================================================

DO $$
DECLARE
  v_sale        RECORD;
  v_entity      RECORD;
  v_next_seq    BIGINT;
  v_period      TEXT;
  v_new_serial  TEXT;
  v_vat_rate    NUMERIC := 18;
  v_vat_amount  INTEGER;
  v_net_amount  INTEGER;
  v_total       NUMERIC;
BEGIN

  -- ── 1. Fetch the sale ───────────────────────────────────────
  SELECT s.id, s.vendor_id, s.invoice_entity_id,
         s.invoice_no, s.receipt_no, s.tax_serial,
         s.document_type, s.total, s.created_at
  INTO   v_sale
  FROM   sales s
  WHERE  s.receipt_no = 'RCP-00001'
  LIMIT  1;

  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Sale RCP-00001 not found';
  END IF;

  IF v_sale.tax_serial IS NOT NULL THEN
    RAISE EXCEPTION 'Sale already has gazette serial: %. Aborting.', v_sale.tax_serial;
  END IF;

  -- ── 2. Fetch the invoice entity ─────────────────────────────
  SELECT id, serial_qqqq
  INTO   v_entity
  FROM   invoice_entities
  WHERE  id = v_sale.invoice_entity_id
  LIMIT  1;

  IF v_entity.id IS NULL THEN
    RAISE EXCEPTION 'Invoice entity not found for this sale';
  END IF;

  -- ── 3. Build the period string from the sale date ───────────
  --      format: YYMM  e.g. '26JUN'
  SELECT TO_CHAR(v_sale.created_at AT TIME ZONE 'Asia/Colombo',
                 'YY') ||
         UPPER(TO_CHAR(v_sale.created_at AT TIME ZONE 'Asia/Colombo',
                 'MON'))
  INTO   v_period;

  -- ── 4. Reserve next gazette serial via existing RPC ─────────
  SELECT next_invoice_serial(v_entity.id, v_period) INTO v_next_seq;

  v_new_serial := v_period || '_' || v_entity.serial_qqqq
                  || '_' || LPAD(v_next_seq::TEXT, 5, '0');

  -- ── 5. Calculate VAT (extracted from VAT-inclusive total) ───
  v_total      := v_sale.total;
  v_vat_amount := ROUND(v_total * v_vat_rate / (100 + v_vat_rate))::INTEGER;
  v_net_amount := v_total::INTEGER - v_vat_amount;

  -- ── 6. Update the sale row ──────────────────────────────────
  UPDATE sales
  SET
    invoice_no    = v_new_serial,
    tax_serial    = v_new_serial,
    receipt_no    = NULL,
    document_type = 'tax_invoice',
    net_amount    = v_net_amount,
    vat_amount    = v_vat_amount
  WHERE id = v_sale.id;

  RAISE NOTICE 'Promoted RCP-00001 → % | Total: Rs.% | VAT: Rs.% | Net: Rs.%',
    v_new_serial, v_total, v_vat_amount, v_net_amount;

END $$;

-- ── VERIFY ───────────────────────────────────────────────────
SELECT invoice_no, tax_serial, receipt_no, document_type,
       total, net_amount, vat_amount, customer_name
FROM   sales
WHERE  invoice_no LIKE '26JUN_PART_%'
ORDER  BY tax_serial;
