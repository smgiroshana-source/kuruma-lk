-- ═══════════════════════════════════════════════════════════════════════════
-- What the supplier actually credited for returned goods (owner, 2026-09-02)
--
-- WHEEL MART sends stock back to suppliers, and the supplier may allow the full
-- cost, part of it, or nothing at all. The existing supplier_returns feature
-- recorded the goods leaving but had nowhere to put that answer: it knew only
-- what the goods cost US. It also never touched what we owe the supplier, so a
-- credit note had to be entered separately and by hand, with nothing tying the
-- two together.
--
-- Where the money goes, once the credit is agreed:
--
--   credited to an unpaid invoice  → a supplier_credit_note, which lowers that
--                                    invoice's balance the same way one entered
--                                    by hand would
--   refunded in cash               → a cash_movements row, so the drawer count
--                                    is right. Cost recovery, not income
--   refunded to the bank           → recorded on the return; the drawer is
--                                    untouched
--   nothing allowed                → the whole cost is the shortfall
--
-- The shortfall — what the goods cost us, less what the supplier allowed — is a
-- real loss and becomes an expense on the day the credit is agreed. Without it
-- the stock leaves at Rs.10,000, Rs.7,000 comes back and the missing Rs.3,000
-- appears nowhere, leaving the month Rs.3,000 better than it was.
--
-- Safe to re-run: every step is guarded.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Columns ─────────────────────────────────────────────────────────────
-- cost_of_goods is what the stock was really carried at, taken from the FIFO
-- layers when the return is confirmed. total_amount is what the operator typed;
-- this is the honest basis for the loss.
alter table public.supplier_returns add column if not exists cost_of_goods numeric;
alter table public.supplier_returns add column if not exists credit_amount numeric;
alter table public.supplier_returns add column if not exists credit_method text;
alter table public.supplier_returns add column if not exists credit_supplier_invoice_id uuid;
alter table public.supplier_returns add column if not exists credit_reference text;
alter table public.supplier_returns add column if not exists credit_recorded_at timestamptz;
alter table public.supplier_returns add column if not exists credit_recorded_by uuid;
-- The rows this return created, so the credit can be undone without hunting.
alter table public.supplier_returns add column if not exists shortfall_expense_id uuid;
alter table public.supplier_returns add column if not exists credit_note_id uuid;
alter table public.supplier_returns add column if not exists credit_movement_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_returns_credit_method_chk') then
    alter table public.supplier_returns
      add constraint supplier_returns_credit_method_chk
      check (credit_method is null or credit_method in ('invoice', 'cash', 'bank', 'none'));
  end if;
end $$;

create index if not exists supplier_returns_credit_idx
  on public.supplier_returns (vendor_id, credit_recorded_at desc);

-- ── 2. Widen three check constraints ───────────────────────────────────────
--
-- Each list below is the existing one, read from pg_get_constraintdef, with a
-- single value appended. Written out in full and on purpose: two earlier
-- attempts tried to edit the rendered definition with string replacement and
-- both failed silently, because these definitions carry no ::text[] cast for a
-- pattern to hook onto. Spelling the values out is duller and correct.
--
--   supplier_return_loss  an expense category, so the loss appears in the
--                         profit report as its own line, not buried in "other"
--   none                  an expense payment_method — the shortfall moves no
--                         money. It must NOT be 'cash', or the day's expected
--                         drawer would drop for money that never left it
--   supplier_refund_in    a cash movement: drawer up, profit unaffected. The
--                         loss is the expense above, so counting the refund as
--                         income too would flatter the day twice

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'expenses_category_check'
       and position('supplier_return_loss' in pg_get_constraintdef(oid)) > 0
  ) then
    alter table public.expenses drop constraint if exists expenses_category_check;
    alter table public.expenses add constraint expenses_category_check
      check (category = any (array[
        'grocery', 'rent', 'electricity', 'water', 'stationery', 'internet',
        'transport', 'maintenance', 'commission', 'other', 'salaries',
        'repairs', 'utilities', 'fuel', 'bank_charges', 'tax', 'petty_cash',
        'consumables', 'tools', 'insurance', 'advertising',
        'supplier_return_loss'
      ]::text[]));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'expenses_payment_method_check'
       and position('''none''' in pg_get_constraintdef(oid)) > 0
  ) then
    alter table public.expenses drop constraint if exists expenses_payment_method_check;
    alter table public.expenses add constraint expenses_payment_method_check
      check (payment_method = any (array[
        'cash', 'online', 'cheque', 'bank', 'card', 'none'
      ]::text[]));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'cash_movements_type_check'
       and position('supplier_refund_in' in pg_get_constraintdef(oid)) > 0
  ) then
    alter table public.cash_movements drop constraint if exists cash_movements_type_check;
    alter table public.cash_movements add constraint cash_movements_type_check
      check (type = any (array[
        'owner_in', 'bank_in', 'to_bank', 'owner_out', 'supplier_refund_in'
      ]::text[]));
  end if;
end $$;

-- ── 3. Verify ──────────────────────────────────────────────────────────────
-- Last statement, so this is what the SQL editor shows. Each definition should
-- now contain the new value, and every value it had before.
select conname, pg_get_constraintdef(c.oid) as definition
  from pg_constraint c join pg_class t on t.oid = c.conrelid
 where c.conname in ('expenses_category_check',
                     'expenses_payment_method_check',
                     'cash_movements_type_check')
 order by conname;
