-- ─────────────────────────────────────────────────────────────────────────────
-- Card machine fee as an expense — WHEEL MART (owner, 2026-09-27)
--
-- The bank keeps card_fee_pct (tax_config, default 3.5%) of every card
-- payment and settles the rest. The books counted the full card amount as
-- received and charged no fee, so profit read high and the bank never
-- reconciled.
--
-- One 'bank_charges' expense per day that has card payments:
--   amount   = round(sum of that day's card payments × card_fee_pct / 100)
--   method   = 'online' (it comes off the bank settlement, not the drawer)
--   reference= 'CARDFEE-YYYY-MM-DD' (the row the trigger keeps in step)
-- A trigger on payments recomputes the day whenever a card payment is
-- added, changed or removed — from any screen (POS, drafts, credit
-- collection, claims). A day left with no card payments loses its row.
-- Refunds (negative card payments) do not reduce it: the bank keeps its fee.
--
-- lk_tax vendors only. Existing card payments are backfilled at the end.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.sync_card_fee(p_vendor uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pct numeric;
  v_sum numeric;
  v_n   integer;
  v_fee integer;
  v_ref text := 'CARDFEE-' || to_char(p_day, 'YYYY-MM-DD');
  v_desc text;
begin
  if not exists (select 1 from vendor_settings where vendor_id = p_vendor and invoice_mode = 'lk_tax') then
    return;
  end if;

  select coalesce((select nullif(value, '')::numeric from tax_config
                    where vendor_id = p_vendor and key = 'card_fee_pct'), 3.5)
    into v_pct;

  select coalesce(sum(amount), 0), count(*)
    into v_sum, v_n
    from payments
   where vendor_id = p_vendor
     and payment_method = 'card'
     and amount > 0
     and (created_at at time zone 'Asia/Colombo')::date = p_day;

  v_fee := round(v_sum * v_pct / 100);

  if v_fee <= 0 then
    delete from expenses
     where vendor_id = p_vendor and category = 'bank_charges' and reference = v_ref;
    return;
  end if;

  v_desc := 'Card machine fee ' || trim_scale(v_pct)::text || '% on ' || v_n
         || ' card payment' || case when v_n = 1 then '' else 's' end
         || ' (Rs.' || trim(to_char(v_sum, 'FM999,999,999')) || ')';

  update expenses
     set amount = v_fee, description = v_desc, expense_date = p_day
   where vendor_id = p_vendor and category = 'bank_charges' and reference = v_ref;

  if not found then
    insert into expenses (vendor_id, expense_date, category, description, amount, payment_method, reference)
    values (p_vendor, p_day, 'bank_charges', v_desc, v_fee, 'online', v_ref);
  end if;
end;
$$;

create or replace function public.payments_card_fee_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.payment_method = 'card' then
    perform sync_card_fee(old.vendor_id, (old.created_at at time zone 'Asia/Colombo')::date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.payment_method = 'card' then
    perform sync_card_fee(new.vendor_id, (new.created_at at time zone 'Asia/Colombo')::date);
  end if;
  return null;
end;
$$;

drop trigger if exists payments_card_fee on public.payments;
create trigger payments_card_fee
  after insert or update or delete on public.payments
  for each row execute function public.payments_card_fee_trigger();

-- Only the trigger calls these — never the API roles
revoke all on function public.sync_card_fee(uuid, date) from public, anon, authenticated;
revoke all on function public.payments_card_fee_trigger() from public, anon, authenticated;

-- Backfill every day that already has card payments
do $$
declare r record;
begin
  for r in
    select distinct p.vendor_id, (p.created_at at time zone 'Asia/Colombo')::date as d
      from payments p
      join vendor_settings vs on vs.vendor_id = p.vendor_id and vs.invoice_mode = 'lk_tax'
     where p.payment_method = 'card'
  loop
    perform sync_card_fee(r.vendor_id, r.d);
  end loop;
end $$;

select expense_date, amount, description
  from expenses where category = 'bank_charges' and reference like 'CARDFEE-%'
 order by expense_date;
