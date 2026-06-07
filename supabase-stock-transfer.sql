-- ══════════════════════════════════════════════════════════════════════════════
-- INTER-VENDOR STOCK TRANSFER — audit table
-- Run in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stock_transfers (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  from_vendor_id      UUID        NOT NULL REFERENCES vendors(id),
  from_product_id     UUID        NOT NULL REFERENCES products(id),
  from_product_sku    TEXT        NOT NULL,
  from_product_name   TEXT        NOT NULL,
  to_vendor_id        UUID        NOT NULL REFERENCES vendors(id),
  to_product_id       UUID        REFERENCES products(id),   -- null until product created
  to_product_name     TEXT,
  quantity            INTEGER     NOT NULL CHECK (quantity > 0),
  transfer_cost       INTEGER,    -- cost at destination (whole LKR, optional)
  transfer_price      INTEGER,    -- selling price at destination (whole LKR, optional)
  notes               TEXT,
  transferred_by      UUID        REFERENCES auth.users(id),
  transferred_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Fast lookups for history panels in each vendor's dashboard
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from
  ON stock_transfers (from_vendor_id, transferred_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_to
  ON stock_transfers (to_vendor_id, transferred_at DESC);
