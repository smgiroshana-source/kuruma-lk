-- ═══════════════════════════════════════════════════════════════════════════
-- Close the database to the public key (security review, 2026-09-02)
--
-- The anon key ships in every browser that opens kuruma.lk — it is public by
-- design. Probed with nothing but that key and no login, the database allowed:
--
--   READ    every sale (1,087), every sale line, every payment including
--           cheque numbers, every customer with phone/email/address, every
--           product with its cost and shelf location, every vendor row
--   INSERT  sales, customers, payments — forged invoices into the ledger
--   UPDATE  sales, customers, products — any price, any stock, any invoice
--   DELETE  products (the statement was accepted)
--
-- Some tables (expenses, vendor_staff, cash_movements) already refused. The
-- rest either had RLS off or a policy that let anon through.
--
-- The application never needs the anon key to touch these tables. Every read
-- and write goes through an API route using the service-role client, which
-- bypasses RLS; the only browser-side Supabase calls are auth.* (login,
-- password reset, session). So the right policy is the simplest one: RLS on
-- everywhere, and no policy for anon or authenticated at all. The public
-- storefront keeps working because /api/store and /api/products/[id] read
-- through the service role too.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
  loop
    -- RLS on, and forced even for the table owner, so a future "permissive"
    -- policy cannot be added by accident without being deliberate.
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('alter table public.%I force row level security', t.relname);
    -- Take the grants away from the two roles the public key can act as.
    -- The service role is not affected: it bypasses RLS and keeps its grants.
    execute format('revoke all on table public.%I from anon', t.relname);
    execute format('revoke all on table public.%I from authenticated', t.relname);
  end loop;
end $$;

-- Drop any policy that let anon or authenticated through. A policy that
-- exists but grants nothing is harmless; one that grants SELECT to anon is
-- the hole this closes.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname, roles
      from pg_policies
     where schemaname = 'public'
       and (roles::text[] && array['anon','authenticated','public'])
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
    raise notice 'dropped policy % on % (roles %)', p.policyname, p.tablename, p.roles;
  end loop;
end $$;

-- Sequences too: an anon that can call nextval() can burn invoice numbers.
do $$
declare
  s record;
begin
  for s in select sequencename from pg_sequences where schemaname = 'public' loop
    execute format('revoke all on sequence public.%I from anon', s.sequencename);
    execute format('revoke all on sequence public.%I from authenticated', s.sequencename);
  end loop;
end $$;

-- And functions the public key could invoke directly (adjust_product_quantity,
-- consume_fifo_cost, next_invoice_serial ...). The API calls these through the
-- service role.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from anon', f.sig);
    execute format('revoke all on function %s from authenticated', f.sig);
  end loop;
end $$;

-- ── Verify: nothing in public should be reachable by anon any more ──
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       c.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select,
       has_table_privilege('anon', c.oid, 'INSERT') as anon_can_insert,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authed_can_select
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by anon_can_select desc, c.relname;
