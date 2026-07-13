-- Insurance-company flag on customers.
-- Insurers approve amounts EXCLUDING VAT, so when a flagged customer is
-- selected in the WHEEL MART POS the price-entry mode auto-switches to
-- "Excl. VAT +18%" (operator types the approved figure, VAT added on top).
-- Run once in the Supabase SQL editor.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_insurance boolean NOT NULL DEFAULT false;
