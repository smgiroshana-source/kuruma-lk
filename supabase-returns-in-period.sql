-- ═══════════════════════════════════════════════════════════════════════════
-- A return belongs to the period it happened in (owner, 2026-09-01)
--
-- Returning goods used to reduce sales.total on the ORIGINAL sale, which
-- rewrote a month that had already closed. Commission runs on a 25th–24th
-- cycle, so the damage is concrete: SAK-00501 sold for Rs.1,100,000 in the May
-- cycle was paid commission on, then a return five days into June rewrote May
-- down to zero — while June, where the goods actually came back, showed nothing
-- to offset it. Eleven Sakura returns worth Rs.3,364,000 crossed a cycle that
-- way and nothing ever clawed any of it back.
--
-- The owner's rule: the sale keeps what it sold for, and the return reduces the
-- period it was raised in. A Rs.100,000 return on 5 September comes off the
-- 25 Aug–24 Sep cycle, not off the closed one.
--
-- This is also what CLAUDE.md already requires of credit notes — reduce
-- turnover in the period ISSUED, not the original invoice period. Tax invoices
-- already behaved this way (returns against them are refused outright and must
-- go through a credit note). Only receipts did the opposite.
--
-- This restores the 28 affected sales to what they actually sold for and moves
-- the returned value into returned_amount. What each customer owes does not
-- change: balance_due is recomputed as total − returned − paid.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create temp table _restore on commit drop as
select s.id,
       s.invoice_no,
       s.total                                             as old_total,
       s.subtotal                                          as old_subtotal,
       coalesce(s.paid_amount, 0)                          as paid,
       sum(si.quantity * si.unit_price)                    as sold_subtotal,
       sum(coalesce(si.returned_quantity, 0) * si.unit_price) as returned_value,
       -- goods sent out on approval and brought back were never a sale; leave
       -- those voided rather than resurrecting them as revenue
       (s.invoice_no like '%-OP-%')                        as on_approval
  from public.sales s
  join public.sale_items si on si.sale_id = s.id
 where s.tax_serial is null
   and exists (select 1 from public.sale_items x
                where x.sale_id = s.id and coalesce(x.returned_quantity, 0) > 0)
 group by s.id, s.invoice_no, s.total, s.subtotal, s.paid_amount;

update public.sales s
   set subtotal        = r.sold_subtotal,
       total           = r.sold_subtotal - coalesce(s.discount, 0),
       returned_amount = r.returned_value,
       balance_due     = greatest(0, (r.sold_subtotal - coalesce(s.discount, 0)) - r.returned_value - r.paid),
       -- A fully returned sale is not a void: it happened, and it is reversed
       -- in the period the goods came back. Voiding removed it from its own
       -- month, which is the same retroactive rewrite by another name.
       voided_at       = case when r.on_approval then s.voided_at else null end,
       payment_status  = case
                           when r.on_approval then s.payment_status
                           when greatest(0, (r.sold_subtotal - coalesce(s.discount, 0)) - r.returned_value - r.paid) > 0 then 'partial'
                           else 'paid'
                         end
  from _restore r
 where s.id = r.id
   and not r.on_approval;

-- On-approval sales keep their void, but still record what came back.
update public.sales s
   set returned_amount = r.returned_value
  from _restore r
 where s.id = r.id and r.on_approval;

commit;

-- ── Verify ──
select s.invoice_no,
       to_char((s.created_at at time zone 'Asia/Colombo')::date, 'YYYY-MM-DD') as sold,
       s.total          as sold_for,
       s.returned_amount,
       s.balance_due    as still_owed,
       s.payment_status
  from public.sales s
 where coalesce(s.returned_amount, 0) > 0
 order by s.created_at desc
 limit 30;
