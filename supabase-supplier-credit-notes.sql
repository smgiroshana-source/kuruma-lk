-- ─────────────────────────────────────────────────────────────────────────────
-- Credit notes RECEIVED from suppliers (discounts, price adjustments)
--
-- A supplier who gives a settlement or quantity discount does not just knock
-- money off — they issue a VAT credit note naming the original invoice. Real
-- example (Tyre House Trading, CRN/046637): net 7,575.44 + VAT 18% 1,363.58 =
-- 8,939.02 against invoice CRI/250787/92, remarked "qty discount of 2.5%".
--
-- Three things have to happen when one arrives, and none of them happened
-- before this table existed:
--   1. The PAYABLE goes down. Until now owed = amount − amount_paid with no
--      credit term at all, so the invoice could never close: you pay the
--      discounted amount and the system shows the discount still outstanding,
--      then overdue, forever.
--   2. INPUT VAT goes down, in the period of the note — IRD Schedule 04 with
--      "Issued By Me = No". That path already exists for goods returned to a
--      supplier; a discount had no way into it because nothing came back off
--      the shelf.
--   3. PROFIT goes up, on its own line (owner decision 2026-08-22): shown as
--      income of the period rather than rewriting what the goods cost, so
--      margins on invoices already issued and printed are never re-stated.
--
-- Amounts are whole rupees like everything else. Supplier notes often carry
-- cents; they are rounded on entry, and IRD schedules are whole-rupee anyway.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.supplier_credit_notes (
  id                  uuid primary key default gen_random_uuid(),
  vendor_id           uuid not null references public.vendors(id) on delete cascade,
  supplier_id         uuid not null references public.suppliers(id),
  -- Which payable it reduces. Nullable: a note can arrive against an invoice
  -- that predates the system, and the VAT still has to be declared.
  supplier_invoice_id uuid references public.supplier_invoices(id) on delete set null,

  credit_note_no      text not null,          -- theirs, e.g. CRN/046637
  credit_note_date    date not null,          -- decides the VAT period
  -- The SUPPLIER's own invoice number and date, copied off the note. Schedule
  -- 04 lists these, not our GRN number.
  invoice_no          text,
  invoice_date        date,

  reason              text not null default 'discount',
  remarks             text,                   -- their wording, verbatim

  net_amount          integer not null check (net_amount >= 0),
  vat_amount          integer not null default 0 check (vat_amount >= 0),
  total_amount        integer not null check (total_amount >= 0),

  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),

  constraint supplier_credit_notes_reason_check
    check (reason in ('discount', 'price_adjustment', 'goods_returned', 'overcharge', 'other')),
  -- The same note must not be entered twice — it would double the VAT claim
  -- reduction and double-credit the payable.
  constraint supplier_credit_notes_unique_no unique (vendor_id, supplier_id, credit_note_no)
);

create index if not exists idx_supplier_credit_notes_vendor
  on public.supplier_credit_notes (vendor_id, credit_note_date desc);
create index if not exists idx_supplier_credit_notes_invoice
  on public.supplier_credit_notes (supplier_invoice_id);

alter table public.supplier_credit_notes enable row level security;

-- Running total of credits applied, so owed = amount − amount_paid − credit_total.
alter table public.supplier_invoices
  add column if not exists credit_total integer not null default 0;

comment on column public.supplier_invoices.credit_total is
  'Supplier credit notes applied to this invoice. Reduces what is owed WITHOUT being a payment — no cash moved, so it must never reach the drawer reconciliation.';

comment on table public.supplier_credit_notes is
  'Credit notes received FROM suppliers. Reduce the payable and input VAT; appear on IRD Schedule 04 as Issued By Me = No.';

-- ── Verify ──
select count(*) as credit_notes from public.supplier_credit_notes;
select invoice_no, amount, amount_paid, credit_total, amount - amount_paid - credit_total as owed
from public.supplier_invoices order by created_at desc limit 10;
