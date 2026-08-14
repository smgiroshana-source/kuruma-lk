-- ─────────────────────────────────────────────────────────────────────────────
-- VAT Filing Centre — fields the IRD schedules need but we weren't capturing
--
-- Schedule 02 (local input) wants the SUPPLIER's invoice date and number, and a
-- disallowed-VAT figure. Schedule 04 also carries credit notes the SUPPLIER
-- issued to US (goods returned to a local supplier) with "Issued By Me = No".
-- ─────────────────────────────────────────────────────────────────────────────

-- Schedule 02: supplier invoice date + disallowed VAT on the GRN.
-- vat_claim_period parks a credit in a later month ('YYYY-MM'; null = claim in
-- the month the goods were received) — the deferral workbench writes it.
alter table public.grns
  add column if not exists supplier_invoice_date date,
  add column if not exists disallowed_vat        integer not null default 0,
  add column if not exists vat_claim_period      text;

-- Schedule 04 (Issued By Me = No): the credit note the supplier sent back
alter table public.supplier_returns
  add column if not exists supplier_credit_note_no   text,
  add column if not exists supplier_credit_note_date date,
  add column if not exists supplier_invoice_no       text,
  add column if not exists supplier_invoice_date     date,
  add column if not exists credit_vat                integer not null default 0;

-- One credit note number per supplier — catches a note entered twice
create unique index if not exists supplier_returns_crn_uniq
  on public.supplier_returns (vendor_id, supplier_id, supplier_credit_note_no)
  where supplier_credit_note_no is not null;

-- Filing Centre reads these by claim period constantly
create index if not exists grns_vat_claim_period_idx
  on public.grns (vendor_id, vat_claim_period) where input_vat > 0;
create index if not exists supplier_returns_crn_date_idx
  on public.supplier_returns (vendor_id, supplier_credit_note_date)
  where supplier_credit_note_no is not null;
