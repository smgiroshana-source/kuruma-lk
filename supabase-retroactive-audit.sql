-- ═══════════════════════════════════════════════════════════════════════════
-- Who did it, and when it was really done (owner, 2026-09-01)
--
-- A sale's date is typed by the operator: create_sale lets saleDate overwrite
-- created_at, with no bound. That is deliberate and useful — Sakura enters
-- yesterday's counter sales the next morning, 29 times out of 34. But it also
-- means a closed day can be rewritten at any time, and nothing showed it.
--
-- The owner chose visibility over restriction: keep the workflow, surface the
-- act on the daily report. Two things were missing for that to work.
--
--   entered_at  the moment the row was actually written. The true time only
--               survived on sale_items.created_at, which is indirect and
--               absent for a sale with no lines. Set by the database, never
--               by the client, so it cannot be typed.
--   created_by  WHO. sales, payments and voids recorded nobody at all, and no
--               audit table exists. A report that says a day was rewritten but
--               not by whom gives the owner something to worry about and
--               nobody to ask.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.sales add column if not exists entered_at timestamptz;
alter table public.sales add column if not exists created_by uuid;
alter table public.sales add column if not exists voided_by uuid;
alter table public.payments add column if not exists created_by uuid;

-- Backfill the true entry time from the first line written for each sale —
-- the only place it survived.
update public.sales s
   set entered_at = sub.first_line
  from (select sale_id, min(created_at) as first_line
          from public.sale_items group by sale_id) sub
 where s.id = sub.sale_id and s.entered_at is null;

-- A sale with no lines has no better evidence than its own stated date.
update public.sales set entered_at = created_at where entered_at is null;

-- From here on the database stamps it. The insert must not pass entered_at.
alter table public.sales alter column entered_at set default now();

-- The daily report asks "what was entered on this day", so index that.
create index if not exists sales_entered_at_idx on public.sales (vendor_id, entered_at);

-- ── Verify: sales whose typed date is not the day they were really entered ──
select to_char((s.created_at at time zone 'Asia/Colombo')::date, 'YYYY-MM-DD') as shown_as,
       to_char((s.entered_at at time zone 'Asia/Colombo')::date, 'YYYY-MM-DD') as really_entered,
       count(*) as sales
  from public.sales s
 where (s.created_at at time zone 'Asia/Colombo')::date
    <> (s.entered_at at time zone 'Asia/Colombo')::date
 group by 1, 2
 order by 2 desc, 1 desc
 limit 20;
