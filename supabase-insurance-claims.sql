-- ═══════════════════════════════════════════════════════════════════════════
-- Insurance claims — stage 1: the claim spine (WHEEL MART)
--
-- One accident repair = one claim = up to three kinds of paper to the insurer:
--   · WHEEL MART parts tax invoice   (PART entity — our revenue, our VAT)
--   · Workshop repair tax invoice    (REPR entity — our revenue, our VAT)
--   · Outside vendors' own bills     (pass-through — NEVER our revenue/VAT)
--
-- This migration creates the claim record both apps share, links sales rows
-- to it, and stores the third-party bills with BOTH amounts: what the insurer
-- sees (bill_amount) and what actually left our pocket (paid_amount) — the
-- spread on a vendor-discounted bill is job profit, and it is only visible
-- because both numbers are captured at the time.
--
-- Stage 2 (settlements + shortfall classification) builds on these tables.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.insurance_claims (
  id                   uuid primary key default gen_random_uuid(),
  vendor_id            uuid not null references public.vendors(id) on delete cascade,
  insurer_customer_id  uuid not null references public.customers(id),
  claim_no             text not null,
  vehicle_no           text,
  workshop_job_ref     text,
  status               text not null default 'open'
                       check (status in ('open', 'settling', 'closed')),
  notes                text,
  created_by           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One claim number per insurer (case-insensitive: "AB123" and "ab123" are the
-- same claim, typed by different people).
create unique index if not exists idx_claims_unique
  on public.insurance_claims (vendor_id, insurer_customer_id, lower(claim_no));
create index if not exists idx_claims_status
  on public.insurance_claims (vendor_id, status);

-- Both of the claim's OWN invoices point at it (PART sale and REPR sale).
alter table public.sales add column if not exists claim_id uuid
  references public.insurance_claims(id) on delete set null;
create index if not exists idx_sales_claim on public.sales (claim_id)
  where claim_id is not null;

-- Outside vendors' bills submitted under the claim. Not our supply — no
-- serial, no VAT, no SSCL, ever. bill_amount is what the insurer reimburses;
-- paid_amount is what we actually handed the vendor (null when the insurer
-- pays the vendor directly and no money of ours moved).
create table if not exists public.claim_third_party_bills (
  id            uuid primary key default gen_random_uuid(),
  claim_id      uuid not null references public.insurance_claims(id) on delete cascade,
  vendor_id     uuid not null references public.vendors(id) on delete cascade,
  supplier_name text not null,
  bill_ref      text,
  bill_amount   integer not null check (bill_amount >= 0),
  paid_amount   integer check (paid_amount >= 0),
  fronted       boolean not null default true,
  reimbursed_amount integer not null default 0 check (reimbursed_amount >= 0),
  note          text,
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_tp_bills_claim on public.claim_third_party_bills (claim_id);

alter table public.insurance_claims enable row level security;
alter table public.claim_third_party_bills enable row level security;

comment on table public.insurance_claims is
  'One insurer claim tying together the PART invoice, the REPR invoice and any pass-through vendor bills.';
comment on table public.claim_third_party_bills is
  'Outside vendors'' bills submitted to the insurer under a claim. Pass-through: never MacForce revenue, VAT or SSCL.';

-- ── Verify ──
select 'insurance_claims' as t, count(*) from public.insurance_claims
union all
select 'claim_third_party_bills', count(*) from public.claim_third_party_bills;
