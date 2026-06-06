-- ============================================================
-- WHEEL MART — Phase 4 Migration
-- Run in Supabase: Dashboard → SQL Editor → New Query
--
-- Adds:
--   1. grn_sequences  — atomic GRN number counter per vendor
--   2. grns           — Goods Received Note headers
--   3. grn_items      — GRN line items (product + qty + cost)
--   4. cost_layers    — FIFO stock cost layers (consumed in Phase 4-C)
--   5. next_grn_serial() — atomic GRN number function
-- ============================================================

-- ── 1. GRN sequence counter ───────────────────────────────────
CREATE TABLE IF NOT EXISTS grn_sequences (
  vendor_id    UUID    PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  last_number  INTEGER NOT NULL DEFAULT 0
);

-- ── 2. GRN headers ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grns (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id           UUID        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  supplier_id         UUID        REFERENCES suppliers(id),
  supplier_name       TEXT,                         -- snapshot of supplier name at time of GRN
  grn_number          TEXT        NOT NULL,         -- e.g. GRN-00001
  supplier_invoice_no TEXT,                         -- supplier's own invoice/bill number
  received_at         DATE        NOT NULL DEFAULT CURRENT_DATE,
  notes               TEXT,
  status              TEXT        NOT NULL DEFAULT 'draft',  -- 'draft' | 'posted'
  -- Totals (whole LKR, updated when items change or on post)
  net_cost            INTEGER     NOT NULL DEFAULT 0,   -- sum of item totals excl VAT
  input_vat           INTEGER     NOT NULL DEFAULT 0,   -- VAT paid on purchase
  total_cost          INTEGER     NOT NULL DEFAULT 0,   -- net_cost + input_vat
  posted_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. GRN line items ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grn_items (
  id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id       UUID     NOT NULL REFERENCES grns(id) ON DELETE CASCADE,
  product_id   UUID     REFERENCES products(id),
  product_name TEXT     NOT NULL,
  product_sku  TEXT,
  quantity     INTEGER  NOT NULL CHECK (quantity > 0),
  unit_cost    INTEGER  NOT NULL DEFAULT 0,  -- excl VAT, whole LKR
  vat_rate     NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 0 or 18
  vat_amount   INTEGER  NOT NULL DEFAULT 0,  -- round(unit_cost * qty * vat_rate / 100)
  total_cost   INTEGER  NOT NULL DEFAULT 0,  -- quantity * unit_cost (excl VAT)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. FIFO cost layers ───────────────────────────────────────
-- Created when a GRN is posted. Consumed (quantity_remaining reduced)
-- as sales are made. Used in Phase 4-C for COGS and gross profit.
CREATE TABLE IF NOT EXISTS cost_layers (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id          UUID    NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_id         UUID    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  grn_id             UUID    REFERENCES grns(id),
  grn_item_id        UUID    REFERENCES grn_items(id),
  quantity_received  INTEGER NOT NULL,
  quantity_remaining INTEGER NOT NULL,  -- decremented as stock is sold (FIFO)
  unit_cost          INTEGER NOT NULL,  -- whole LKR excl VAT
  received_at        DATE    NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. Atomic GRN serial function ────────────────────────────
CREATE OR REPLACE FUNCTION next_grn_serial(p_vendor_id UUID)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v_num INTEGER;
BEGIN
  INSERT INTO grn_sequences(vendor_id, last_number)
  VALUES (p_vendor_id, 1)
  ON CONFLICT (vendor_id) DO UPDATE
    SET last_number = grn_sequences.last_number + 1
  RETURNING last_number INTO v_num;
  RETURN v_num;
END;
$$;

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_grns_vendor       ON grns(vendor_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_grns_status       ON grns(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_grn_items_grn     ON grn_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_product ON grn_items(product_id);
CREATE INDEX IF NOT EXISTS idx_cost_layers_prod  ON cost_layers(product_id, received_at, quantity_remaining);
CREATE INDEX IF NOT EXISTS idx_cost_layers_vendor ON cost_layers(vendor_id);

-- ── VERIFY ───────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('grns','grn_items','cost_layers','grn_sequences');
-- SELECT proname FROM pg_proc WHERE proname = 'next_grn_serial';
