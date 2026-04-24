-- Add require_vehicle_no flag to customers
-- Default FALSE — only specific customers will have this enabled
ALTER TABLE customers ADD COLUMN IF NOT EXISTS require_vehicle_no BOOLEAN DEFAULT FALSE;
