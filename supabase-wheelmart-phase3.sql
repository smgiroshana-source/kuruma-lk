-- ============================================================
-- WHEEL MART — Phase 3 Migration
-- Run in Supabase: Dashboard → SQL Editor → New Query
--
-- 1. returned_amount column on sales — tracks cumulative value
--    of items returned against a gazette tax invoice without
--    mutating the original gazette-stamped amounts.
--
-- 2. credit_notes table — for future full credit note flow
--    (referenced here so the schema is ready; UI in Phase 4).
-- ============================================================

-- ── 1. returned_amount on sales ──────────────────────────────
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS returned_amount NUMERIC(12,2) DEFAULT 0;

-- ── 2. credit_notes table ────────────────────────────────────
-- Stores credit notes issued against gazette tax invoices.
-- A credit note is a legal document that reverses output VAT
-- and SSCL turnover for the returned items.
CREATE TABLE IF NOT EXISTS credit_notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  invoice_entity_id UUID REFERENCES invoice_entities(id),
  -- Reference back to the original tax invoice
  original_sale_id UUID NOT NULL REFERENCES sales(id),
  original_serial  TEXT NOT NULL,          -- e.g. 26JUN_PART_00001
  -- Credit note identifier (own series, not gazette serial)
  credit_note_no   TEXT NOT NULL,          -- e.g. CRN-00001
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason           TEXT,                   -- 'goods_returned' | 'overcharge' | 'cancelled'
  -- Customer snapshot (copied from original)
  customer_name    TEXT,
  customer_address TEXT,
  customer_tin     TEXT,
  -- Amounts (positive = amount being credited back)
  net_amount       INTEGER NOT NULL DEFAULT 0,   -- whole LKR
  vat_amount       INTEGER NOT NULL DEFAULT 0,   -- whole LKR
  total            INTEGER NOT NULL DEFAULT 0,   -- whole LKR
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_note_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id   UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  original_item_id UUID REFERENCES sale_items(id),  -- link back to original line
  product_name     TEXT NOT NULL,
  quantity         INTEGER NOT NULL,
  unit_price       INTEGER NOT NULL,    -- whole LKR (VAT-inclusive)
  total            INTEGER NOT NULL,    -- quantity × unit_price
  sscl_stream      TEXT NOT NULL DEFAULT 'PART'  -- 'PART' | 'SVC'
);

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_credit_notes_vendor      ON credit_notes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_sale        ON credit_notes(original_sale_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_items_cn     ON credit_note_items(credit_note_id);

-- ── VERIFY ───────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'sales' AND column_name = 'returned_amount';
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('credit_notes', 'credit_note_items');
