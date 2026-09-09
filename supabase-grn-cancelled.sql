-- ═══════════════════════════════════════════════════════════════════════════
-- GRN numbers are never lost (owner, 2026-09-09)
--
-- GRN-V-00003 was minted and then lost: a draft was deleted (or a save failed
-- after the header was written) and the number went with it. The V series
-- is the VAT register, so a hole in it is a question an auditor will ask.
--
-- From now on a deleted draft keeps its number as a CANCELLED row unless it
-- is still the latest number, in which case the counter is stepped back and
-- the number is reused. This file records the one that was already lost.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.grns drop constraint if exists grns_status_check;
alter table public.grns add constraint grns_status_check
  check (status in ('draft', 'posted', 'reversed', 'cancelled'));

-- The placeholder for the number that was lost before this fix.
-- WHEEL MART = 46f52c93-ee4b-4b28-bcd6-eb79ff11c503
insert into public.grns (vendor_id, grn_number, grn_series, status, received_at, net_cost, input_vat, total_cost, notes)
select '46f52c93-ee4b-4b28-bcd6-eb79ff11c503', 'GRN-V-00003', 'V', 'cancelled', '2026-09-09', 0, 0, 0,
       'Number minted and lost before cancelled drafts were kept (2026-09-09). No goods received, no supplier document.'
 where not exists (
   select 1 from public.grns
    where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503' and grn_number = 'GRN-V-00003'
 );

-- ── Verify: V series reads 1, 2, 3 (cancelled), 4 ──
select grn_number, status, supplier_name, received_at
  from public.grns
 where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503' and grn_series = 'V'
 order by grn_number;
