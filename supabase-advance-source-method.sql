-- ═══════════════════════════════════════════════════════════════════════════
-- Advance payments remember where the credit came from (owner, 2026-09-05)
--
-- A tax invoice must not show "ADVANCE" as a payment method. The credit was
-- cash or a bank transfer when it arrived; the printed invoice names that.
-- The ledger keeps the row as 'advance' (so the day's cash and bank are not
-- counted twice) and source_method carries the label for the print.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.payments
  add column if not exists source_method text;

-- 26SEP_PART_00003 (Mr. Sarish): the Rs.1,800 credit came from the tube on
-- PRCP-00286, which he paid by bank transfer.
update public.payments
   set source_method = 'bank'
 where id = '123b01da-58ef-45e8-90f2-56e0fcb7fa14'
   and payment_method = 'advance'
   and amount = 1800;

-- ── Verify: one row, source_method = bank ──
select p.id, s.invoice_no, p.amount, p.payment_method, p.source_method
  from public.payments p join public.sales s on s.id = p.sale_id
 where s.tax_serial = '26SEP_PART_00003';
