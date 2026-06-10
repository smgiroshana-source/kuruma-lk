-- ============================================================
-- Phase 9 Migration — atomic invoice numbering for STANDARD
-- (non-lk_tax) sales serials. Run in Supabase SQL Editor.
--
-- Fixes: generateInvoiceNo/generateDraftNo in sales/route.ts
-- read MAX(invoice_no) then insert — two concurrent sales can
-- mint the same SAK-XXXXX number. This adds a per-vendor atomic
-- counter (same pattern as next_invoice_serial / next_grn_serial).
--
-- Series values used by the app:
--   'regular' → SAK-00001 style sales invoices
--   'op'      → SAK-OP-0001 style On Approval drafts
--
-- The counter SEEDS ITSELF from the existing max invoice_no the
-- first time it is called for a vendor+series, so no manual
-- backfill is needed.
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_sequences (
  vendor_id   UUID NOT NULL,
  series      TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (vendor_id, series)
);

CREATE OR REPLACE FUNCTION next_vendor_seq(p_vendor_id UUID, p_series TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_next INTEGER;
  v_seed INTEGER;
BEGIN
  -- Seed from existing sales on first use so the sequence continues
  -- from where the old read-max code left off.
  IF NOT EXISTS (SELECT 1 FROM vendor_sequences WHERE vendor_id = p_vendor_id AND series = p_series) THEN
    IF p_series = 'op' THEN
      SELECT COALESCE(MAX((regexp_match(invoice_no, '-OP-(\d+)$'))[1]::int), 0)
        INTO v_seed FROM sales
       WHERE vendor_id = p_vendor_id AND invoice_no ~ '-OP-\d+$';
    ELSE
      SELECT COALESCE(MAX((regexp_match(invoice_no, '-(\d+)$'))[1]::int), 0)
        INTO v_seed FROM sales
       WHERE vendor_id = p_vendor_id
         AND invoice_no ~ '-\d+$'
         AND invoice_no NOT LIKE '%-OP-%'
         AND invoice_no NOT LIKE 'DRAFT-%';
    END IF;
    INSERT INTO vendor_sequences (vendor_id, series, last_number)
    VALUES (p_vendor_id, p_series, v_seed)
    ON CONFLICT (vendor_id, series) DO NOTHING;
  END IF;

  UPDATE vendor_sequences
     SET last_number = last_number + 1
   WHERE vendor_id = p_vendor_id AND series = p_series
  RETURNING last_number INTO v_next;

  RETURN v_next;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION next_vendor_seq(UUID, TEXT) TO service_role;

-- Verify:
-- SELECT next_vendor_seq('<vendor_uuid>', 'regular');
