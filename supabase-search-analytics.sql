-- Search Analytics: Run this in Supabase SQL Editor
-- ================================================

-- 1. Create the search_logs table
CREATE TABLE search_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  query text NOT NULL DEFAULT '',
  category text,
  condition_filter text,
  make_filter text,
  result_count integer NOT NULL DEFAULT 0,
  user_id uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX idx_search_logs_created_at ON search_logs (created_at DESC);
CREATE INDEX idx_search_logs_query ON search_logs (query) WHERE query != '';

-- RLS enabled, no policies (only service-role admin client accesses this table)
ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;

-- 2. Aggregation RPC functions

CREATE OR REPLACE FUNCTION get_top_searches(since_date timestamptz, limit_count int)
RETURNS TABLE(query text, count bigint, avg_results numeric) AS $$
  SELECT query, COUNT(*) as count, ROUND(AVG(result_count), 0) as avg_results
  FROM search_logs
  WHERE query != '' AND created_at >= since_date
  GROUP BY query
  ORDER BY count DESC
  LIMIT limit_count;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_top_categories(since_date timestamptz, limit_count int)
RETURNS TABLE(category text, count bigint) AS $$
  SELECT category, COUNT(*) as count
  FROM search_logs
  WHERE category IS NOT NULL AND created_at >= since_date
  GROUP BY category
  ORDER BY count DESC
  LIMIT limit_count;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_top_makes(since_date timestamptz, limit_count int)
RETURNS TABLE(make_filter text, count bigint) AS $$
  SELECT make_filter, COUNT(*) as count
  FROM search_logs
  WHERE make_filter IS NOT NULL AND created_at >= since_date
  GROUP BY make_filter
  ORDER BY count DESC
  LIMIT limit_count;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_daily_search_volume(since_date timestamptz)
RETURNS TABLE(date date, count bigint) AS $$
  SELECT created_at::date as date, COUNT(*) as count
  FROM search_logs
  WHERE created_at >= since_date
  GROUP BY created_at::date
  ORDER BY date ASC;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_zero_result_searches(since_date timestamptz, limit_count int)
RETURNS TABLE(query text, count bigint) AS $$
  SELECT query, COUNT(*) as count
  FROM search_logs
  WHERE query != '' AND result_count = 0 AND created_at >= since_date
  GROUP BY query
  ORDER BY count DESC
  LIMIT limit_count;
$$ LANGUAGE sql SECURITY DEFINER;
