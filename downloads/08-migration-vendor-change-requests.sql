-- ============================================================
-- Feature 8: Vendor Detail Changes with Admin Approval
-- Run this in Supabase SQL Editor FIRST before deploying code
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_change_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  requested_changes JSONB NOT NULL,
  current_values JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_change_requests_vendor
  ON vendor_change_requests(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_vendor_change_requests_status
  ON vendor_change_requests(status);

ALTER TABLE vendor_change_requests ENABLE ROW LEVEL SECURITY;
