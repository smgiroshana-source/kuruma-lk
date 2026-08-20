-- ─────────────────────────────────────────────────────────────────────────────
-- Which vendors may transfer stock to each other
--
-- Until now two shops could only see each other if they shared an owner login
-- or a staff login. WHEEL MART and Sakura are the same business but registered
-- under different accounts, so neither could transfer to the other — while
-- unrelated marketplace vendors (Colombo Auto Spares, Kandy Parts Hub…) must
-- never be able to, which is why the rule can't simply be widened.
--
-- A link is MUTUAL: one row lets stock move both ways. Deliberately not
-- self-service — sending stock into someone else's inventory is exactly the
-- thing that needs a deliberate act to enable.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.vendor_transfer_links (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  linked_vendor_id uuid not null references public.vendors(id) on delete cascade,
  note text,
  created_at timestamptz default now(),
  constraint vendor_transfer_links_distinct check (vendor_id <> linked_vendor_id),
  unique (vendor_id, linked_vendor_id)
);

create index if not exists vendor_transfer_links_v_idx on public.vendor_transfer_links (vendor_id);
create index if not exists vendor_transfer_links_l_idx on public.vendor_transfer_links (linked_vendor_id);

alter table public.vendor_transfer_links enable row level security;

comment on table public.vendor_transfer_links is
  'Vendor pairs allowed to transfer stock. Mutual: one row works both ways.';

-- The pair that prompted this: MACFORCE (WHEEL MART) ↔ Sakura Auto Parts
insert into public.vendor_transfer_links (vendor_id, linked_vendor_id, note)
select '46f52c93-ee4b-4b28-bcd6-eb79ff11c503', '0ae910a5-da00-4e1a-9bf2-7245b825cf90',
       'Same business, separate logins — owner request 2026-08-20'
where not exists (
  select 1 from public.vendor_transfer_links
  where (vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503' and linked_vendor_id = '0ae910a5-da00-4e1a-9bf2-7245b825cf90')
     or (vendor_id = '0ae910a5-da00-4e1a-9bf2-7245b825cf90' and linked_vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503')
);

select l.note, a.name as vendor, b.name as linked_vendor
from public.vendor_transfer_links l
join public.vendors a on a.id = l.vendor_id
join public.vendors b on b.id = l.linked_vendor_id;
