-- ═══════════════════════════════════════════════════════════════════════════
-- How a stored cost relates to VAT (owner, 2026-08-26)
--
-- The product list grossed EVERY lk_tax cost up by 18% and labelled it "incl
-- VAT", assuming a stored cost is always net of a VAT that was really paid.
-- Three different things are actually true in this shop:
--
--   1. GRN from a NON-VAT-registered supplier — no input VAT exists at all.
--      Show the figure as it stands, with no VAT wording. (Owner: "never show
--      VAT for GRN items from non VAT registered supplier.")
--   2. CSV-imported stock (the IT/… tyres and tubes) — the cost typed in
--      already INCLUDED VAT. Show it as it stands, and say "incl VAT",
--      because it does. Grossing it up again double-counted.
--   3. GRN from a VAT-registered supplier — cost is net and VAT was paid on
--      top. Gross up by that rate. None exist yet; the column is ready.
--
--   cost_vat_rate     VAT to ADD to the stored figure for display (0 = none)
--   cost_includes_vat the stored figure already contains VAT
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products add column if not exists cost_vat_rate numeric;
alter table public.products add column if not exists cost_includes_vat boolean;

-- Case 3 then 1: whatever the product's own posted GRN line charged.
update public.products p
   set cost_vat_rate = sub.vat_rate, cost_includes_vat = false
  from (
    select distinct on (gi.product_id) gi.product_id, gi.vat_rate
      from public.grn_items gi
      join public.grns g on g.id = gi.grn_id
     where g.status = 'posted' and gi.product_id is not null
     order by gi.product_id, g.received_at desc
  ) sub
 where p.id = sub.product_id
   and p.cost_vat_rate is null;

-- Case 2: the CSV import. Those SKUs are the marker — costs entered VAT-inclusive.
update public.products
   set cost_vat_rate = 0, cost_includes_vat = true
 where cost_vat_rate is null
   and coalesce(cost, 0) > 0
   and sku like 'IT/%';

-- Anything else with a cost: the figure is what was paid, no VAT in it.
update public.products
   set cost_vat_rate = 0, cost_includes_vat = false
 where cost_vat_rate is null and coalesce(cost, 0) > 0;

-- ── Verify ──
select coalesce(cost_vat_rate::text, 'unset') as add_vat,
       coalesce(cost_includes_vat::text, 'unset') as already_incl,
       count(*) as products
  from public.products
 where coalesce(cost, 0) > 0
 group by 1, 2
 order by 1, 2;
