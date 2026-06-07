-- ══════════════════════════════════════════════════════════════════════════════
-- WHEEL MART — Phases 1–8 Migration
-- Run in Supabase SQL Editor (single pass — tables ordered by dependency)
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 1 · Stock movements + min stock level
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS min_stock_level INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS stock_movements (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id       UUID        NOT NULL REFERENCES vendors(id),
  product_id      UUID        NOT NULL REFERENCES products(id),
  product_sku     TEXT        NOT NULL,
  movement_type   TEXT        NOT NULL
    CHECK (movement_type IN (
      'grn_receive','sale','return_in','return_out',
      'transfer_out','transfer_in','writeoff','adjustment'
    )),
  quantity_change INTEGER     NOT NULL,
  quantity_before INTEGER     NOT NULL,
  quantity_after  INTEGER     NOT NULL,
  reference_id    UUID,
  reference_type  TEXT,
  notes           TEXT,
  created_by      UUID        REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product
  ON stock_movements (vendor_id, product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_recent
  ON stock_movements (vendor_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 2 · Supplier invoices + payments
-- ─────────────────────────────────────────────────────────────────────────────

-- suppliers table already exists — add missing columns
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS address       TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms INTEGER     NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS notes         TEXT,
  ADD COLUMN IF NOT EXISTS is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id       UUID        NOT NULL REFERENCES vendors(id),
  supplier_id     UUID        NOT NULL REFERENCES suppliers(id),
  grn_id          UUID        REFERENCES grns(id),
  invoice_no      TEXT        NOT NULL,
  invoice_date    DATE        NOT NULL,
  due_date        DATE        NOT NULL,
  amount          INTEGER     NOT NULL CHECK (amount > 0),
  amount_paid     INTEGER     NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid','partial','paid','overdue')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_due
  ON supplier_invoices (vendor_id, due_date);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id                  UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id           UUID    NOT NULL REFERENCES vendors(id),
  supplier_id         UUID    NOT NULL REFERENCES suppliers(id),
  supplier_invoice_id UUID    REFERENCES supplier_invoices(id),
  amount              INTEGER NOT NULL CHECK (amount > 0),
  payment_date        DATE    NOT NULL,
  method              TEXT    NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash','bank','cheque','card')),
  reference           TEXT,
  notes               TEXT,
  created_by          UUID    REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_date
  ON supplier_payments (vendor_id, payment_date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 3 · Supplier returns
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS supplier_returns (
  id           UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id    UUID    NOT NULL REFERENCES vendors(id),
  supplier_id  UUID    NOT NULL REFERENCES suppliers(id),
  return_no    TEXT    NOT NULL,
  return_date  DATE    NOT NULL,
  reason       TEXT,
  notes        TEXT,
  total_amount INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed')),
  created_by   UUID    REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (vendor_id, return_no)
);

CREATE TABLE IF NOT EXISTS supplier_return_items (
  id           UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  return_id    UUID    NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
  product_id   UUID    NOT NULL REFERENCES products(id),
  product_sku  TEXT    NOT NULL,
  product_name TEXT    NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost    INTEGER NOT NULL,
  total_cost   INTEGER NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 4 · Customer returns enhancement
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS return_reason TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 5 · Stock write-offs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_writeoffs (
  id            UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id     UUID    NOT NULL REFERENCES vendors(id),
  writeoff_no   TEXT    NOT NULL,
  writeoff_date DATE    NOT NULL,
  reason        TEXT    NOT NULL
    CHECK (reason IN ('damaged','expired','lost','theft','other')),
  notes         TEXT,
  total_cost    INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','posted')),
  created_by    UUID    REFERENCES auth.users(id),
  posted_by     UUID    REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  posted_at     TIMESTAMPTZ,
  UNIQUE (vendor_id, writeoff_no)
);

CREATE TABLE IF NOT EXISTS stock_writeoff_items (
  id           UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  writeoff_id  UUID    NOT NULL REFERENCES stock_writeoffs(id) ON DELETE CASCADE,
  product_id   UUID    NOT NULL REFERENCES products(id),
  product_sku  TEXT    NOT NULL,
  product_name TEXT    NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost    INTEGER NOT NULL,
  total_cost   INTEGER NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 6 · Fleet accounts first, then vehicles (dependency order)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_accounts (
  id            UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id     UUID    NOT NULL REFERENCES vendors(id),
  company_name  TEXT    NOT NULL,
  contact_name  TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  tin           TEXT,
  credit_limit  INTEGER NOT NULL DEFAULT 0,
  payment_terms INTEGER NOT NULL DEFAULT 30,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fleet_vendor
  ON fleet_accounts (vendor_id);

CREATE TABLE IF NOT EXISTS customer_vehicles (
  id               UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id        UUID    NOT NULL REFERENCES vendors(id),
  customer_id      UUID    REFERENCES customers(id),
  fleet_account_id UUID    REFERENCES fleet_accounts(id),
  plate_no         TEXT    NOT NULL,
  make             TEXT,
  model            TEXT,
  year             SMALLINT,
  color            TEXT,
  fuel_type        TEXT
    CHECK (fuel_type IN ('petrol','diesel','hybrid','electric','other')),
  engine_no        TEXT,
  chassis_no       TEXT,
  notes            TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (vendor_id, plate_no)
);

CREATE INDEX IF NOT EXISTS idx_vehicles_plate
  ON customer_vehicles (vendor_id, plate_no);

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 7 · Cash sessions + expenses
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cash_sessions (
  id              UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id       UUID    NOT NULL REFERENCES vendors(id),
  session_date    DATE    NOT NULL,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  closing_balance INTEGER,
  expected_cash   INTEGER,
  cash_expenses   INTEGER,
  variance        INTEGER,
  status          TEXT    NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','closed')),
  notes           TEXT,
  opened_by       UUID    REFERENCES auth.users(id),
  closed_by       UUID    REFERENCES auth.users(id),
  opened_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  closed_at       TIMESTAMPTZ,
  UNIQUE (vendor_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_date
  ON cash_sessions (vendor_id, session_date DESC);

CREATE TABLE IF NOT EXISTS expenses (
  id              UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id       UUID    NOT NULL REFERENCES vendors(id),
  expense_date    DATE    NOT NULL,
  category        TEXT    NOT NULL
    CHECK (category IN (
      'rent','utilities','salaries','fuel','maintenance',
      'repairs','bank_charges','tax','petty_cash','other'
    )),
  description     TEXT    NOT NULL,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  payment_method  TEXT    NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash','bank','card')),
  reference       TEXT,
  cash_session_id UUID    REFERENCES cash_sessions(id),
  created_by      UUID    REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_date
  ON expenses (vendor_id, expense_date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 8 · No new tables (reorder + GP are computed from existing data)
-- ─────────────────────────────────────────────────────────────────────────────

-- Done ✓
