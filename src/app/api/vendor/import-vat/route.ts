import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ─────────────────────────────────────────────────────────────────────────────
// Import shipments — one record per Customs declaration (IRD VAT Schedule 03).
//
// This is the data-entry home for "a container arrived": the Cusdec and the
// import VAT paid on it. Deliberately independent of products — a shipment
// holds thousands of parts and the VAT is levied on the declaration, so goods
// can be bulk-uploaded with no cost at all without touching VAT claiming.
// Claim window for imports: 24 months.
// ─────────────────────────────────────────────────────────────────────────────

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, email: user.email || '', role: 'owner' }
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { vendor: staffLink.vendor, email: user.email || '', role: staffLink.role || 'cashier' }
  return null
}

const monthOf = (d: string) => String(d).slice(0, 7)
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const claimableOf = (im: any) =>
  parseInt(im.vat_upfront || 0) + parseInt(im.vat_deferred || 0) - parseInt(im.disallowed_vat || 0)

export async function GET() {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('import_vat_entries')
    .select('*')
    .eq('vendor_id', auth.vendor.id)
    .order('cusdec_date', { ascending: false })
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const now = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
  const nowMonth = monthOf(now)
  const entries = (data || []).map((im: any) => {
    const originMonth = monthOf(im.cusdec_date)
    const claimPeriod = im.vat_claim_period || originMonth
    const expiryMonth = addMonths(originMonth, 24)
    const [ey, em] = expiryMonth.split('-').map(Number)
    const [ny, nm] = nowMonth.split('-').map(Number)
    return {
      ...im,
      claimable: claimableOf(im),
      originMonth, claimPeriod, expiryMonth,
      monthsLeft: (ey - ny) * 12 + (em - nm),
      deferred: claimPeriod !== originMonth,
      claimed: claimPeriod <= nowMonth,
    }
  })

  return NextResponse.json({
    entries,
    totals: {
      count: entries.length,
      claimable: entries.reduce((s: number, e: any) => s + e.claimable, 0),
      pending: entries.filter((e: any) => !e.claimed).reduce((s: number, e: any) => s + e.claimable, 0),
      expiringSoon: entries.filter((e: any) => !e.claimed && e.monthsLeft <= 3).length,
    },
    role: auth.role,
  })
}

export async function POST(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { vendor, email } = auth
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({}))

  if (body.action === 'add') {
    // One entry, or many at once when an IRD Schedule 03 CSV is uploaded
    const entries = Array.isArray(body.entries) ? body.entries : [body.entry]
    const rows = entries.filter(Boolean).map((e: any) => ({
      vendor_id: vendor.id,
      cusdec_no: String(e.cusdecNo || '').trim(),
      cusdec_date: e.cusdecDate,
      cusdec_serial_id: e.cusdecSerialId?.trim() || null,
      cusdec_reg_date: e.cusdecRegDate || null,
      cusdec_office_id: e.cusdecOfficeId?.trim() || null,
      vat_deferred: Math.round(Number(e.vatDeferred) || 0),
      vat_upfront: Math.round(Number(e.vatUpfront) || 0),
      disallowed_vat: Math.round(Number(e.disallowedVat) || 0),
      supplier: e.supplier?.trim() || null,
      reference: e.reference?.trim() || null,
      notes: e.notes?.trim() || null,
      created_by: email,
    }))
    if (rows.length === 0) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
    const bad = rows.find((r: any) => !r.cusdec_no || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.cusdec_date || '')))
    if (bad) return NextResponse.json({ error: 'Every row needs a Cusdec number and a valid date' }, { status: 400 })
    // Re-uploading a corrected schedule updates rather than duplicating
    const { error } = await admin.from('import_vat_entries').upsert(rows, { onConflict: 'vendor_id,cusdec_no,cusdec_date' })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, saved: rows.length })
  }

  if (body.action === 'delete') {
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const { error } = await admin.from('import_vat_entries').delete().eq('id', body.id).eq('vendor_id', vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'set_claim_period') {
    const { id, period } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (period !== null && !/^\d{4}-\d{2}$/.test(String(period || ''))) {
      return NextResponse.json({ error: 'period must be YYYY-MM or null' }, { status: 400 })
    }
    const { data: im } = await admin.from('import_vat_entries')
      .select('cusdec_date, cusdec_no').eq('id', id).eq('vendor_id', vendor.id).single()
    if (!im) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    if (period) {
      const originMonth = monthOf(im.cusdec_date)
      const limit = addMonths(originMonth, 24)
      if (period < originMonth) return NextResponse.json({ error: `Cannot claim before the Cusdec month (${originMonth})` }, { status: 400 })
      if (period > limit) return NextResponse.json({ error: `${im.cusdec_no}: past the 24-month import deadline (${limit})` }, { status: 400 })
    }
    const { error } = await admin.from('import_vat_entries').update({ vat_claim_period: period }).eq('id', id).eq('vendor_id', vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
