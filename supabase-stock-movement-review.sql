-- ═══════════════════════════════════════════════════════════════════════════
-- Count corrections can be marked reviewed (owner, 2026-09-16)
--
-- The dashboard's "Stock counts corrected down this month" line stayed for
-- the whole month with no way to say "I have looked at this". The line exists
-- so the owner sees every correction; once seen, it has done its job. An
-- owner or manager marks the month's corrections reviewed and the line goes;
-- a new correction brings it back counting only the unreviewed ones. Nothing
-- is deleted — reports keep showing the correction with who reviewed it.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.stock_movements
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid;

create index if not exists stock_movements_review_idx
  on public.stock_movements (vendor_id, movement_type, created_at)
  where reviewed_at is null;

-- ── Verify ──
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'stock_movements'
   and column_name in ('reviewed_at', 'reviewed_by');
