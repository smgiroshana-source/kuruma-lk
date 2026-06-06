-- ============================================================
-- WHEEL MART — Phase 1 Migration
-- Run in Supabase: Dashboard → SQL Editor → New Query
--
-- SAFE TO RUN: all changes are additive.
--   • New columns are nullable (or have defaults) — existing
--     vendor rows are unaffected, existing code keeps working.
--   • New tables don't touch anything existing.
--   • IF NOT EXISTS / ON CONFLICT guards prevent double-run errors.
--
-- ONE placeholder remaining — fill this in before running:
--
--   YOUR_AUTH_USER_UUID  → Supabase Dashboard → Authentication
--                           → Users → find smgiroshana@gmail.com → copy User UID
--
-- All other values are already filled in.
-- ============================================================


-- ── SECTION 1: NEW COLUMNS ON EXISTING TABLES ──────────────
-- All nullable or defaulted — zero impact on other vendors.

-- vendor_settings: enable lk_tax mode + supplier identity for invoice header
ALTER TABLE vendor_settings
  ADD COLUMN IF NOT EXISTS invoice_mode     TEXT    DEFAULT 'simple'
    CHECK (invoice_mode IN ('simple', 'lk_tax')),
  ADD COLUMN IF NOT EXISTS supplier_tin     TEXT,        -- 9-digit TIN shown on tax invoices
  ADD COLUMN IF NOT EXISTS supplier_address TEXT;        -- full address shown on tax invoices

-- products: type + tyre-specific attributes + SSCL stream tag
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_type  TEXT  DEFAULT 'part'
    CHECK (product_type IN ('part', 'tyre', 'service')),
  ADD COLUMN IF NOT EXISTS sscl_stream   TEXT  DEFAULT 'PART'
    CHECK (sscl_stream IN ('PART', 'SVC')),  -- PART=50% base, SVC=100% base
  ADD COLUMN IF NOT EXISTS tyre_size     TEXT,           -- e.g. '195/65R15'
  ADD COLUMN IF NOT EXISTS tyre_brand    TEXT,
  ADD COLUMN IF NOT EXISTS tyre_pattern  TEXT,           -- tread pattern name
  ADD COLUMN IF NOT EXISTS load_index    TEXT,           -- e.g. '91'
  ADD COLUMN IF NOT EXISTS speed_rating  TEXT,           -- e.g. 'H'
  ADD COLUMN IF NOT EXISTS dot_code      TEXT;           -- manufacture week/year e.g. '2423'

-- customers: VAT status + TIN + address (required for tax invoices)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS vat_registered    BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tin               TEXT,     -- nullable; 9-digit; only if vat_registered
  ADD COLUMN IF NOT EXISTS address           TEXT;     -- required when issuing a tax invoice

-- customers: vehicle-number requirement flag
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS require_vehicle_no BOOLEAN DEFAULT FALSE;

-- sales: entity link, document type, gazette serial, receipt no,
--        VAT breakdown, date of supply, void timestamp
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS invoice_entity_id  UUID,         -- which legal entity issued this
  ADD COLUMN IF NOT EXISTS document_type      TEXT  DEFAULT 'receipt'
    CHECK (document_type IN ('receipt', 'tax_invoice')),
  ADD COLUMN IF NOT EXISTS tax_serial         TEXT,         -- gazette serial e.g. '26JUN_PART_00042'
  ADD COLUMN IF NOT EXISTS receipt_no         TEXT,         -- e.g. 'RCP-00001'
  ADD COLUMN IF NOT EXISTS net_amount         INTEGER,      -- NET excl. VAT  (whole LKR)
  ADD COLUMN IF NOT EXISTS vat_amount         INTEGER,      -- VAT amount      (whole LKR)
  ADD COLUMN IF NOT EXISTS date_supply        DATE,         -- Date of Supply (MM/DD/YYYY on invoice)
  ADD COLUMN IF NOT EXISTS voided_at          TIMESTAMPTZ; -- set when voided; NULL = not voided

-- sale_items: SSCL stream per line item
--   inventory items  → PART (50% liable base)
--   manual/service   → SVC  (100% liable base)
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS sscl_stream TEXT DEFAULT 'PART'
    CHECK (sscl_stream IN ('PART', 'SVC'));


-- ── SECTION 2: NEW TABLES ────────────────────────────────────

-- Suppliers (local LKR + Japan JPY)
CREATE TABLE IF NOT EXISTS suppliers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      UUID        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  contact_name   TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  country        TEXT        DEFAULT 'LK',     -- 'LK' local | 'JP' Japan
  currency       TEXT        DEFAULT 'LKR',    -- 'LKR' | 'JPY'
  vat_registered BOOLEAN     DEFAULT FALSE,
  tin            TEXT,                          -- supplier TIN (for input VAT claims)
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Invoice entities: one row per legal entity (Pvt Ltd + Proprietorship)
CREATE TABLE IF NOT EXISTS invoice_entities (
  id             UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      UUID     NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name           TEXT     NOT NULL,            -- legal name shown on invoice
  address        TEXT,                         -- address shown on invoice
  tin            TEXT,                         -- 9-digit TIN (NULL for non-VAT entity)
  vat_registered BOOLEAN  DEFAULT FALSE,
  invoice_mode   TEXT     DEFAULT 'simple'
    CHECK (invoice_mode IN ('simple', 'lk_tax')),
  serial_qqqq    TEXT     DEFAULT 'PART',      -- QQQQ segment of gazette serial
  receipt_prefix TEXT     DEFAULT 'RCP',       -- prefix for sales receipts
  is_default     BOOLEAN  DEFAULT FALSE,       -- Pvt Ltd = true (pre-selected at POS)
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Only one default entity allowed per vendor
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_entities_one_default
  ON invoice_entities(vendor_id)
  WHERE is_default = TRUE;

-- Gapless sequences for both gazette serials and receipt numbers
--   period = '26JUN' for gazette serials (monthly reset allowed)
--   period = 'receipt' for RCP- series (continuous)
CREATE TABLE IF NOT EXISTS invoice_sequences (
  id          UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   UUID     NOT NULL REFERENCES invoice_entities(id) ON DELETE CASCADE,
  period      TEXT     NOT NULL,
  last_number INTEGER  NOT NULL DEFAULT 0,
  UNIQUE (entity_id, period)
);

-- Tax rates config — never hardcoded in app code
--   Keys: vat_rate | sscl_rate | liable_base_part | liable_base_svc
CREATE TABLE IF NOT EXISTS tax_config (
  id        UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID  NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  key       TEXT  NOT NULL,
  value     TEXT  NOT NULL,
  UNIQUE (vendor_id, key)
);


-- ── SECTION 3: FOREIGN KEY (sales → invoice_entities) ────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_sales_invoice_entity'
  ) THEN
    ALTER TABLE sales
      ADD CONSTRAINT fk_sales_invoice_entity
      FOREIGN KEY (invoice_entity_id)
      REFERENCES invoice_entities(id);
  END IF;
END $$;


-- ── SECTION 4: INDEXES ───────────────────────────────────────

-- sales lookups
CREATE INDEX IF NOT EXISTS idx_sales_invoice_entity
  ON sales(invoice_entity_id) WHERE invoice_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_tax_serial
  ON sales(tax_serial) WHERE tax_serial IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_receipt_no
  ON sales(receipt_no) WHERE receipt_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_document_type
  ON sales(vendor_id, document_type);
CREATE INDEX IF NOT EXISTS idx_sales_voided
  ON sales(vendor_id, voided_at) WHERE voided_at IS NOT NULL;

-- product lookups
CREATE INDEX IF NOT EXISTS idx_products_type
  ON products(vendor_id, product_type);
CREATE INDEX IF NOT EXISTS idx_products_tyre_size
  ON products(vendor_id, tyre_size) WHERE tyre_size IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_sscl_stream
  ON products(vendor_id, sscl_stream);

-- customer VAT lookups
CREATE INDEX IF NOT EXISTS idx_customers_vat_registered
  ON customers(vendor_id, vat_registered) WHERE vat_registered = TRUE;

-- supplier lookups
CREATE INDEX IF NOT EXISTS idx_suppliers_vendor
  ON suppliers(vendor_id);

-- sequence lookups (used by the atomic serial function)
CREATE INDEX IF NOT EXISTS idx_invoice_sequences_lookup
  ON invoice_sequences(entity_id, period);


-- ── SECTION 5: ATOMIC SERIAL FUNCTION ───────────────────────
-- Called from app code when issuing a gazette serial or receipt number.
-- Uses INSERT...ON CONFLICT...DO UPDATE — atomic in Postgres.
-- Concurrent calls are safe: no two calls return the same number.
-- Usage:
--   SELECT next_invoice_serial('<entity_uuid>', '26JUN');   → gazette
--   SELECT next_invoice_serial('<entity_uuid>', 'receipt'); → RCP series

CREATE OR REPLACE FUNCTION next_invoice_serial(
  p_entity_id UUID,
  p_period    TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_next INTEGER;
BEGIN
  INSERT INTO invoice_sequences (entity_id, period, last_number)
    VALUES (p_entity_id, p_period, 1)
  ON CONFLICT (entity_id, period)
    DO UPDATE SET last_number = invoice_sequences.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN v_next;
END;
$$;


-- ── SECTION 6: SEED DATA ─────────────────────────────────────
-- !! REPLACE YOUR_AUTH_USER_UUID BEFORE RUNNING !!
--
--   YOUR_AUTH_USER_UUID  → Supabase Dashboard → Authentication → Users
--                           → find smgiroshana@gmail.com → copy the User UID

DO $$
DECLARE
  v_user_id   UUID := 'YOUR_AUTH_USER_UUID';   -- ← LAST THING TO FILL IN
  v_vendor_id UUID;
BEGIN

  -- ── Create WHEEL MART vendor ─────────────────────────────────
  -- ON CONFLICT DO NOTHING → safe to re-run (no duplicate created)
  INSERT INTO vendors (
    user_id, name, slug, phone, whatsapp,
    location, address, description, status
  ) VALUES (
    v_user_id,
    'WHEEL MART',
    'wheel-mart',
    '0112777788',
    '0112777788',
    'Thalawathugoda',
    'No. 351/T, Pannipitiya Road, Thalawathugoda',
    'Tyres & spare parts — Thalawathugoda',
    'approved'                                -- skip 'pending' since we own the DB
  )
  ON CONFLICT DO NOTHING;

  -- Capture vendor ID (works whether just inserted or already existed)
  SELECT id INTO v_vendor_id FROM vendors WHERE slug = 'wheel-mart';

  -- ── Initial vendor_settings row ───────────────────────────────
  INSERT INTO vendor_settings (vendor_id, invoice_mode, supplier_tin, supplier_address)
  VALUES (v_vendor_id, 'lk_tax', '101969738', 'No. 351/T, Pannipitiya Road, Thalawathugoda')
  ON CONFLICT (vendor_id) DO UPDATE
    SET invoice_mode     = 'lk_tax',
        supplier_tin     = '101969738',
        supplier_address = 'No. 351/T, Pannipitiya Road, Thalawathugoda';

  -- ── Pvt Ltd entity (default — pre-selected at POS) ────────────
  INSERT INTO invoice_entities (
    vendor_id, name, address, tin,
    vat_registered, invoice_mode, serial_qqqq, receipt_prefix, is_default
  ) VALUES (
    v_vendor_id,
    'MacForce Auto Engineering (Pvt) Ltd',
    'No. 351/T, Pannipitiya Road, Thalawathugoda',
    '101969738',
    TRUE,
    'lk_tax',
    'PART',
    'RCP',
    TRUE                                      -- default entity at POS
  )
  ON CONFLICT DO NOTHING;

  -- ── Proprietorship entity ──────────────────────────────────────
  INSERT INTO invoice_entities (
    vendor_id, name, address, tin,
    vat_registered, invoice_mode, serial_qqqq, receipt_prefix, is_default
  ) VALUES (
    v_vendor_id,
    'Macforce Auto Engineering',
    '555, Pannipitiya Road, Thalawathugoda',
    NULL,                                     -- not VAT-registered, no TIN
    FALSE,
    'simple',
    'PROP',
    'PRCP',
    FALSE
  )
  ON CONFLICT DO NOTHING;

  -- ── Tax config (Pvt Ltd rates — editable in settings UI) ──────
  INSERT INTO tax_config (vendor_id, key, value) VALUES
    (v_vendor_id, 'vat_rate',         '18'),  -- VAT 18%
    (v_vendor_id, 'sscl_rate',        '2.5'), -- SSCL 2.5% on liable turnover
    (v_vendor_id, 'liable_base_part', '50'),  -- parts/tyres: 50% of turnover is liable
    (v_vendor_id, 'liable_base_svc',  '100')  -- services: 100% of turnover is liable
  ON CONFLICT (vendor_id, key) DO NOTHING;

END $$;


-- ── VERIFY ───────────────────────────────────────────────────
-- Run these after the migration to confirm everything looks right:
--
-- SELECT id, name, slug, status FROM vendors WHERE slug = 'wheel-mart';
--
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_name IN ('sales','products','customers','sale_items','vendor_settings')
--    AND column_name IN ('invoice_entity_id','document_type','tax_serial','receipt_no',
--                        'net_amount','vat_amount','date_supply','voided_at',
--                        'product_type','sscl_stream','tyre_size',
--                        'vat_registered','tin','address','invoice_mode')
--  ORDER BY table_name, column_name;
--
-- SELECT * FROM invoice_entities;
-- SELECT * FROM tax_config;
-- SELECT proname FROM pg_proc WHERE proname = 'next_invoice_serial';
