import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ─────────────────────────────────────────────────────────────────────────────
// VAT / SSCL deadlines — owner only (src/lib/taxDeadlines.ts).
//
// done: the owner paid or filed it; the dashboard reminder clears. Amount and
// where the money came from are kept for the record only — NOT an expense:
// VAT never touches profit and SSCL is charged to profit from the period's
// sales, so booking the payment as well would count it twice.
// undo: ticked by mistake — the reminder comes back.
// ─────────────────────────────────────────────────────────────────────────────

const KINDS = ['vat_payment', 'vat_return', 'sscl_payment', 'sscl_return']

async function getOwner() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('id').eq('user_id', user.id).eq('status', 'approved').single()
  return vendor ? { vendor, email: user.email || '' } : null
}

export async function POST(req: NextRequest) {
  const caller = await getOwner()
  if (!caller) return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const { action, kind, period } = body
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown tax item' }, { status: 400 })
  if (!/^\d{4}-(\d{2}|Q[1-4])$/.test(String(period || ''))) return NextResponse.json({ error: 'Bad period' }, { status: 400 })

  if (action === 'done') {
    const amount = body.amount === '' || body.amount == null ? null : Number(body.amount)
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })
    const paidFrom = ['owner', 'bank', 'cash'].includes(body.paidFrom) ? body.paidFrom : null
    const { error } = await admin.from('tax_obligations_done').upsert({
      vendor_id: caller.vendor.id, kind, period,
      done_at: new Date().toISOString(), done_by: caller.email,
      amount, paid_from: kind.endsWith('_payment') ? paidFrom : null,
      note: String(body.note || '').trim() || null,
    }, { onConflict: 'vendor_id,kind,period' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'undo') {
    const { error } = await admin.from('tax_obligations_done').delete()
      .eq('vendor_id', caller.vendor.id).eq('kind', kind).eq('period', period)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
