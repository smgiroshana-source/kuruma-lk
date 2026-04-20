-- ============================================================
-- Migration: Replace warehouse_location with 4-level location columns
-- Run this in Supabase SQL Editor
-- ============================================================

-- Drop the single column added in the previous migration (if it exists)
ALTER TABLE products DROP COLUMN IF EXISTS warehouse_location;

-- Add 4 structured location columns
ALTER TABLE products ADD COLUMN IF NOT EXISTS loc_store TEXT;   -- e.g. "Main Store", "Branch 2"
ALTER TABLE products ADD COLUMN IF NOT EXISTS loc_floor TEXT;   -- e.g. "Ground", "1st Floor"
ALTER TABLE products ADD COLUMN IF NOT EXISTS loc_sub1  TEXT;   -- e.g. "Rack A", "Shelf 3"
ALTER TABLE products ADD COLUMN IF NOT EXISTS loc_sub2  TEXT;   -- e.g. "Bin 5", "Box 12"

-- Index for fast location-based filtering
CREATE INDEX IF NOT EXISTS idx_products_loc_store ON products (vendor_id, loc_store) WHERE loc_store IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_loc_sub1  ON products (vendor_id, loc_sub1)  WHERE loc_sub1  IS NOT NULL;

-- Stock confirmation date: records when qty was physically verified
ALTER TABLE products ADD COLUMN IF NOT EXISTS last_stock_confirmed_at TIMESTAMPTZ;
