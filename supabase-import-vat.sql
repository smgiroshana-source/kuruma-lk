-- ═══════════════════════════════════════════════════════════════════════════
-- Import VAT (IRD VAT Schedule 03) — one row per Customs declaration.
--
-- Why this is separate from GRNs: a single container carries thousands of
-- parts, and the VAT is paid at the Cusdec level. Splitting it across items is
-- impossible (and pointless — IRD wants the Cusdec, not the parts). So import
-- VAT is claimed from these records, and product costs stay an independent
-- question that can be left blank or filled in roughly later.
--
-- Claim window for imports is 24 months (local purchases: 12).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.import_vat_entries (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null,
  cusdec_no text not null,
  cusdec_date date not null,
  cusdec_serial_id text,            -- 'I' etc.
  cusdec_reg_date date,
  cusdec_office_id text,            -- e.g. HBIM1
  vat_deferred integer not null default 0,
  vat_upfront integer not null default 0,
  disallowed_vat integer not null default 0,
  supplier text,                    -- optional: who the shipment came from
  reference text,                   -- optional: container / shipment ref
  notes text,
  vat_claim_period text,            -- 'YYYY-MM'; null = claim in the cusdec's own month
  created_by text,
  created_at timestamptz default now(),
  unique (vendor_id, cusdec_no, cusdec_date)
);

create index if not exists import_vat_claim_idx on public.import_vat_entries (vendor_id, vat_claim_period);
alter table public.import_vat_entries enable row level security;

comment on table public.import_vat_entries is 'IRD VAT Schedule 03 rows — import VAT per Customs declaration';

select 'import_vat_entries ready' as status;
