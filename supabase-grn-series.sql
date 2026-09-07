-- ═══════════════════════════════════════════════════════════════════════════
-- GRN series + tax-invoice confirmation (owner, 2026-09-07)
--
-- One shared GRN sequence meant the VAT register — which lists only the GRNs
-- carrying input VAT — showed GRN-00002 with no GRN-00001 before it. Every
-- non-VAT purchase punched another hole. Three series fix that:
--
--   GRN-V-00001  supplier is VAT-registered  (these are the VAT register)
--   GRN-N-00001  supplier is not registered  (no input VAT to claim)
--   GRN-I-00001  foreign supplier / import   (VAT claimed via CUSDEC)
--
-- Series is decided at goods-receipt from the supplier record. Numbers run
-- continuously per series, no monthly reset — GRNs are internal, nothing in
-- the VAT Act prescribes their shape, and a plain running number is what an
-- auditor can check in seconds.
--
-- Second rule: a claim is only valid when the supplier's tax invoice carries
-- OUR TIN, name and address. The operator now confirms that on the GRN; the
-- claim is never inferred from the series or the VAT figure alone.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.grns
  add column if not exists grn_series text,
  add column if not exists tax_invoice_confirmed boolean not null default false,
  add column if not exists tax_invoice_confirmed_at timestamptz,
  add column if not exists tax_invoice_confirmed_by uuid references auth.users(id);

alter table public.grns drop constraint if exists grns_series_check;
alter table public.grns add constraint grns_series_check
  check (grn_series is null or grn_series in ('V', 'N', 'I'));

create index if not exists idx_grns_series
  on public.grns (vendor_id, grn_series, received_at desc);

-- ── Atomic per-series counter ──────────────────────────────────────────────
-- next_vendor_seq() seeds an unknown series from the SALES table, which is
-- right for invoice series and wrong here. This one starts at zero and rows
-- are created on first use; the UPDATE takes a row lock, so two clerks
-- posting at once get consecutive numbers, never the same one.
create or replace function public.next_grn_series_serial(p_vendor_id uuid, p_series text)
returns integer
language plpgsql
as $$
declare
  v_key  text := 'grn_' || lower(p_series);
  v_next integer;
begin
  if lower(p_series) not in ('v', 'n', 'i') then
    raise exception 'unknown GRN series %', p_series;
  end if;
  insert into public.vendor_sequences (vendor_id, series, last_number)
  values (p_vendor_id, v_key, 0)
  on conflict (vendor_id, series) do nothing;
  update public.vendor_sequences
     set last_number = last_number + 1
   where vendor_id = p_vendor_id and series = v_key
  returning last_number into v_next;
  return v_next;
end;
$$;

revoke all on function public.next_grn_series_serial(uuid, text) from public, anon, authenticated;
grant execute on function public.next_grn_series_serial(uuid, text) to service_role;

-- ── Renumber the two GRNs that exist (WHEEL MART) ──────────────────────────
-- Both are this month's, internal, and quoted only in the payables notes.
-- T&S Tyre Company (not registered)      GRN-00001 → GRN-N-00001
-- Tyre House Trading (VAT-registered)    GRN-00002 → GRN-V-00001
do $$
declare
  v_wm uuid := '46f52c93-ee4b-4b28-bcd6-eb79ff11c503';
  r record;
  v_series text;
  v_n int := 0; v_v int := 0; v_i int := 0;
  v_new text;
begin
  for r in
    select g.id, g.grn_number, g.supplier_vat_registered, s.country
      from public.grns g left join public.suppliers s on s.id = g.supplier_id
     where g.vendor_id = v_wm and g.grn_series is null and g.grn_number ~ '^GRN-\d+$'
     order by g.created_at
  loop
    v_series := case when coalesce(r.country, 'LK') <> 'LK' then 'I'
                     when r.supplier_vat_registered then 'V' else 'N' end;
    if v_series = 'V' then v_v := v_v + 1; v_new := 'GRN-V-' || lpad(v_v::text, 5, '0');
    elsif v_series = 'I' then v_i := v_i + 1; v_new := 'GRN-I-' || lpad(v_i::text, 5, '0');
    else v_n := v_n + 1; v_new := 'GRN-N-' || lpad(v_n::text, 5, '0'); end if;

    update public.grns set grn_series = v_series, grn_number = v_new where id = r.id;
    update public.supplier_invoices
       set notes = replace(notes, r.grn_number, v_new)
     where vendor_id = v_wm and grn_id = r.id and notes like '%' || r.grn_number || '%';
    -- A payable whose invoice number fell back to the GRN number follows it
    update public.supplier_invoices set invoice_no = v_new
     where vendor_id = v_wm and grn_id = r.id and invoice_no = r.grn_number;
    raise notice '% → %', r.grn_number, v_new;
  end loop;

  -- Counters continue from what was just assigned
  insert into public.vendor_sequences (vendor_id, series, last_number) values
    (v_wm, 'grn_v', v_v), (v_wm, 'grn_n', v_n), (v_wm, 'grn_i', v_i)
  on conflict (vendor_id, series) do update set last_number = greatest(public.vendor_sequences.last_number, excluded.last_number);
end $$;

-- ── Verify ──
select grn_number, grn_series, supplier_name, input_vat, tax_invoice_confirmed, received_at
  from public.grns where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503' order by created_at;
select series, last_number from public.vendor_sequences
 where vendor_id = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503' and series like 'grn_%';
