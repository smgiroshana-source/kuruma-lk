-- ═══════════════════════════════════════════════════════════════════════════
-- Tax stage 3: period locks + effective-dated rates
--
-- PERIOD LOCKS — after the VAT return for a month is filed, the owner locks
-- the month. From then on no credit note, bad-debt write-off or recovery can
-- be dated into it; corrections go into the CURRENT period as their own
-- documents, which is both the legal rule and what keeps the filed return
-- forever matching the register. One lock per vendor per month: the return
-- is consolidated across both entities (one TIN), so the lock is too.
--
-- RATE HISTORY — VAT %, SSCL % and the liable-turnover bases, each with an
-- effective-from date. Reports use the rate AS OF each month they cover, so
-- a rate change mid-year never rewrites old quarters. Seeded from today's
-- tax_config so behaviour is identical until a change is ever scheduled.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.vat_period_locks (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references public.vendors(id) on delete cascade,
  period     text not null check (period ~ '^\d{4}-\d{2}$'),
  locked_by  text,
  locked_at  timestamptz not null default now(),
  unique (vendor_id, period)
);

create table if not exists public.tax_rate_history (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null references public.vendors(id) on delete cascade,
  key            text not null,
  value          numeric not null,
  effective_from date not null,
  created_by     text,
  created_at     timestamptz not null default now(),
  unique (vendor_id, key, effective_from)
);
create index if not exists idx_rate_history_lookup
  on public.tax_rate_history (vendor_id, key, effective_from desc);

-- Seed: today's flat config becomes the history's opening entry.
insert into public.tax_rate_history (vendor_id, key, value, effective_from, created_by)
select vendor_id, key, value::numeric, '2000-01-01', 'migration'
from public.tax_config
where key in ('vat_rate', 'sscl_rate', 'liable_base_part', 'liable_base_svc')
on conflict (vendor_id, key, effective_from) do nothing;

alter table public.vat_period_locks enable row level security;
alter table public.tax_rate_history enable row level security;

-- ── Verify ──
select 'vat_period_locks' as t, count(*) from public.vat_period_locks
union all
select 'tax_rate_history', count(*) from public.tax_rate_history;
