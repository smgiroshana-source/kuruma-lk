-- ═══════════════════════════════════════════════════════════════════════════
-- Insurance claims — stage 2: settlements + shortfall classification
--
-- The discharge voucher arrives, the insurer's money is allocated across the
-- claim's documents, and whatever is short must be classified as exactly one:
--
--   CR    customer recoverable (excess / betterment)  → credit note to the
--         insurer + re-invoice to the vehicle owner. Net turnover & VAT
--         unchanged when re-invoiced from the same entity.
--   WD    write-down, accepted as full settlement     → credit note only.
--         Output VAT and SSCL turnover reduce. Owner/manager approval.
--   DISC  deliberate discount                          → same tax effect as
--         WD, plus a reason code. Owner/manager approval.
--   DEBT  still legally due, still chasing             → no documents, no VAT
--         change. VAT relief only on actual write-off (owner), reversed on
--         recovery.
--
-- Third-party (pass-through) bill shortfalls classify as RECOVER / ABSORB —
-- money decisions only, never tax documents.
--
-- HARD RULE enforced in the APIs: once a sale's shortfall is WD or DISC, no
-- later receipt can be recorded against that sale — reducing output tax while
-- still taking the cash is the audit risk this whole feature exists to block.
-- ═══════════════════════════════════════════════════════════════════════════

-- The discharge voucher / settlement payment, entered once per arrival.
create table if not exists public.claim_settlements (
  id             uuid primary key default gen_random_uuid(),
  claim_id       uuid not null references public.insurance_claims(id) on delete cascade,
  vendor_id      uuid not null references public.vendors(id) on delete cascade,
  received_date  date not null,
  voucher_ref    text,
  -- The operator must SAY whether the voucher's figures include VAT — never
  -- inferred. Our invoice totals are VAT-inclusive; ex-VAT vouchers are
  -- grossed up per line before comparison.
  vat_inclusive  boolean not null,
  payment_method text not null default 'bank',
  bank_ref       text,
  gross_amount   integer not null check (gross_amount >= 0),
  notes          text,
  created_by     text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_settlements_claim on public.claim_settlements (claim_id);

-- One settlement split across the claim's documents. Exactly one target per
-- line: one of our sales, or one third-party bill.
create table if not exists public.claim_settlement_lines (
  id             uuid primary key default gen_random_uuid(),
  settlement_id  uuid not null references public.claim_settlements(id) on delete cascade,
  claim_id       uuid not null references public.insurance_claims(id) on delete cascade,
  sale_id        uuid references public.sales(id),
  bill_id        uuid references public.claim_third_party_bills(id),
  -- entered = what the operator typed off the voucher; amount = VAT-inclusive
  -- rupees actually applied to the target (equal when the voucher is incl.)
  entered_amount integer not null check (entered_amount >= 0),
  amount         integer not null check (amount >= 0),
  allocation_method text not null default 'direct'
                 check (allocation_method in ('direct', 'prorata', 'manual')),
  created_at     timestamptz not null default now(),
  constraint one_target check (
    (sale_id is not null and bill_id is null) or
    (sale_id is null and bill_id is not null)
  )
);
create index if not exists idx_settlement_lines_settlement on public.claim_settlement_lines (settlement_id);

-- What is still short on each document after settlements, and what was
-- decided about it. One row per document per claim.
create table if not exists public.claim_shortfalls (
  id              uuid primary key default gen_random_uuid(),
  claim_id        uuid not null references public.insurance_claims(id) on delete cascade,
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  sale_id         uuid references public.sales(id),
  bill_id         uuid references public.claim_third_party_bills(id),
  amount          integer not null check (amount >= 0),
  -- null = unclassified (blocks claim close). Sales: CR/WD/DISC/DEBT.
  -- Third-party bills: RECOVER/ABSORB.
  classification  text check (classification in ('CR', 'WD', 'DISC', 'DEBT', 'RECOVER', 'ABSORB')),
  reason_code     text,
  reason_text     text,
  approved_by     text,
  approved_at     timestamptz,
  -- documents produced by the classification
  credit_note_id  uuid references public.credit_notes(id),
  reinvoice_sale_id uuid references public.sales(id),
  status          text not null default 'open'
                  check (status in ('open', 'actioned', 'written_off', 'recovered')),
  written_off_at  timestamptz,
  recovered_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint one_doc check (
    (sale_id is not null and bill_id is null) or
    (sale_id is null and bill_id is not null)
  )
);
create unique index if not exists idx_shortfall_sale on public.claim_shortfalls (claim_id, sale_id) where sale_id is not null;
create unique index if not exists idx_shortfall_bill on public.claim_shortfalls (claim_id, bill_id) where bill_id is not null;
create index if not exists idx_shortfalls_open on public.claim_shortfalls (vendor_id, status) where classification is null;

-- Credit notes carry the settlement context: the ORIGINAL invoice's VAT rate
-- (never today's), the claim, the classification that produced them and who
-- approved it.
alter table public.credit_notes add column if not exists vat_rate numeric;
alter table public.credit_notes add column if not exists claim_id uuid references public.insurance_claims(id);
alter table public.credit_notes add column if not exists classification text;
alter table public.credit_notes add column if not exists approved_by text;

alter table public.claim_settlements enable row level security;
alter table public.claim_settlement_lines enable row level security;
alter table public.claim_shortfalls enable row level security;

-- ── Verify ──
select 'claim_settlements' as t, count(*) from public.claim_settlements
union all select 'claim_settlement_lines', count(*) from public.claim_settlement_lines
union all select 'claim_shortfalls', count(*) from public.claim_shortfalls;
