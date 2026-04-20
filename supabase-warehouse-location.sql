-- ============================================================
-- Migration: Add warehouse_location to products
-- Run this in Supabase SQL Editor
-- ============================================================

-- Add warehouse_location column to products table
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS warehouse_location TEXT;

-- Optional: index for fast filtering by location
CREATE INDEX IF NOT EXISTS idx_products_warehouse_location
  ON products (vendor_id, warehouse_location)
  WHERE warehouse_location IS NOT NULL;

-- That's it! The column is nullable text — e.g. "Shelf A3", "Rack B2", "Counter"
