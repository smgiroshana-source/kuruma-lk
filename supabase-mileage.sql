-- ═══════════════════════════════════════════════════════════════════════════
-- Vehicle mileage on a sale (WHEEL MART)
--
-- Wheel alignment is recorded against the odometer: the shop needs to know
-- what the reading was, and — for the next visit — how far the car has run
-- since the last alignment. Optional on every sale, prompted when an
-- alignment/service line is on the bill.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.sales add column if not exists mileage_km integer
  check (mileage_km is null or mileage_km >= 0);

-- "What did this vehicle read last time?" — the lookup the POS does while the
-- cashier is still typing, so it must be indexed by vehicle.
create index if not exists idx_sales_vehicle_mileage
  on public.sales (vendor_id, vehicle_no, created_at desc)
  where mileage_km is not null;

comment on column public.sales.mileage_km is
  'Odometer reading (km) at the time of service — recorded for wheel alignment and other mileage-based work.';

-- ── Verify ──
select 'sales.mileage_km' as item,
       (select count(*) from information_schema.columns
         where table_name = 'sales' and column_name = 'mileage_km') as ok;
