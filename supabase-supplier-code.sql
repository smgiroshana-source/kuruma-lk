-- ─────────────────────────────────────────────────────────────────────────────
-- Permanent supplier code: SUP-0001, SUP-0002, …
--
-- Names, addresses and phone numbers change; the code never does, so ledgers,
-- GRNs and statements keep pointing at the same supplier across a rename or
-- rebrand. Assigned by the database on insert (staff never type it), existing
-- suppliers are backfilled in the order they were created, and a trigger
-- refuses any later change — even one made directly in the SQL editor.
--
-- ALTERs the real table. No CREATE TABLE: suppliers already exists in prod.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.suppliers add column if not exists supplier_code text;

create sequence if not exists supplier_code_seq;

-- Backfill existing suppliers, oldest first
with numbered as (
  select id, row_number() over (order by created_at nulls last, id) as rn
  from public.suppliers
  where supplier_code is null
)
update public.suppliers s
   set supplier_code = 'SUP-' || lpad(n.rn::text, 4, '0')
  from numbered n
 where s.id = n.id;

-- Continue numbering after the backfill
select setval('supplier_code_seq',
  greatest(1, (select count(*) from public.suppliers where supplier_code is not null)), true);

-- Auto-assign on insert
create or replace function public.assign_supplier_code() returns trigger as $$
begin
  if new.supplier_code is null then
    new.supplier_code := 'SUP-' || lpad(nextval('supplier_code_seq')::text, 4, '0');
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists trg_assign_supplier_code on public.suppliers;
create trigger trg_assign_supplier_code
  before insert on public.suppliers
  for each row execute function public.assign_supplier_code();

-- Immutable for ever after
create or replace function public.protect_supplier_code() returns trigger as $$
begin
  if old.supplier_code is not null
     and new.supplier_code is distinct from old.supplier_code then
    raise exception 'supplier_code is permanent and cannot be changed (%)', old.supplier_code;
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists trg_protect_supplier_code on public.suppliers;
create trigger trg_protect_supplier_code
  before update on public.suppliers
  for each row execute function public.protect_supplier_code();

create unique index if not exists suppliers_code_uniq
  on public.suppliers (supplier_code) where supplier_code is not null;

select supplier_code, name from public.suppliers order by supplier_code;
