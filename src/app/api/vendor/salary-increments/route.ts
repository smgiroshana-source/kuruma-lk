import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ─────────────────────────────────────────────────────────────────────────────
// Salary rises agreed in advance — "From 2027 Apr salary 60,000".
//
// Owner only. A manager runs the shop's day; what people are paid, and when it
// changes, is the owner's.
//
// Applying is deliberate rather than automatic. A figure that changes itself on
// a date is one nobody checks, and the first sign of an error is an underpaid
// payslip. The owner is reminded in the month it falls due and applies it.
// ─────────────────────────────────────────────────────────────────────────────

async function getCaller() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, userId: user.id, isOwner: true }
  const { data: staff } = await admin.from('vendor_staff')
    .select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staff?.vendor) return { vendor: staff.vendor, userId: user.id, isOwner: false }
  return null
}

/** First day of the month — a raise runs from a payroll period, not mid-month. */
function monthStart(ym: string): string | null {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-01` : null
}

export async function GET(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  if (!caller.isOwner) return NextResponse.json({ error: 'Salary changes are owner-only' }, { status: 403 })

  const admin = createAdminClient()
  const employeeId = req.nextUrl.searchParams.get('employee_id')

  let q = admin.from('salary_increments')
    .select('*, employee:employees(name, branch)')
    .eq('vendor_id', caller.vendor.id)
    .order('effective_from')
  if (employeeId) q = q.eq('employee_id', employeeId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Due = scheduled and the month has arrived. This is what the dashboard nags
  // about, so it is computed here rather than in each caller.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
  const rows = data || []
  return NextResponse.json({
    increments: rows,
    due: rows.filter((r: any) => r.status === 'scheduled' && r.effective_from <= today),
    upcoming: rows.filter((r: any) => r.status === 'scheduled' && r.effective_from > today),
  })
}

export async function POST(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  if (!caller.isOwner) return NextResponse.json({ error: 'Salary changes are owner-only' }, { status: 403 })

  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body

  if (action === 'schedule') {
    const { employeeId, payItemId, effectiveMonth, newAmount, note } = body
    if (!employeeId) return NextResponse.json({ error: 'Pick the employee' }, { status: 400 })
    const effective = monthStart(effectiveMonth)
    if (!effective) return NextResponse.json({ error: 'Pick the month it starts from (YYYY-MM)' }, { status: 400 })
    const amount = Math.round(Number(newAmount) || 0)
    if (amount <= 0) return NextResponse.json({ error: 'The new salary must be more than zero' }, { status: 400 })

    const { data: emp } = await admin.from('employees')
      .select('id, name').eq('id', employeeId).eq('vendor_id', caller.vendor.id).single()
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    // Default to the base pay item — that is what "salary" means on the sheet.
    let itemId = payItemId || null
    let itemLabel = 'Base salary'
    const { data: items } = await admin.from('employee_pay_items')
      .select('id, kind, label, amount').eq('employee_id', employeeId).eq('active', true)
    const target = itemId
      ? (items || []).find((i: any) => i.id === itemId)
      : (items || []).find((i: any) => i.kind === 'base')
    if (target) { itemId = target.id; itemLabel = target.label || 'Base salary' }

    const { data: created, error } = await admin.from('salary_increments').insert({
      vendor_id: caller.vendor.id, employee_id: employeeId,
      pay_item_id: itemId, item_label: itemLabel,
      effective_from: effective, new_amount: amount,
      note: String(note || '').trim() || null,
      created_by: caller.userId,
    }).select().single()

    if (error) {
      if (/salary_increments_unique/.test(error.message)) {
        return NextResponse.json({
          error: `${emp.name} already has a change scheduled for that month — edit or cancel it instead of adding a second.`,
        }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const when = new Date(`${effective}T00:00:00+05:30`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    return NextResponse.json({
      ok: true, increment: created,
      message: `${emp.name}: ${itemLabel} rises to Rs.${amount.toLocaleString()} from ${when}${target ? ` (now Rs.${Number(target.amount).toLocaleString()})` : ''}`,
    })
  }

  if (action === 'apply') {
    const { incrementId } = body
    const { data: inc } = await admin.from('salary_increments')
      .select('*, employee:employees(name)').eq('id', incrementId).eq('vendor_id', caller.vendor.id).single()
    if (!inc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (inc.status !== 'scheduled') return NextResponse.json({ error: `Already ${inc.status}` }, { status: 400 })
    if (!inc.pay_item_id) {
      return NextResponse.json({ error: 'The pay item this applied to no longer exists — set the new salary on the employee directly' }, { status: 400 })
    }

    const { data: item } = await admin.from('employee_pay_items')
      .select('id, amount').eq('id', inc.pay_item_id).single()
    if (!item) return NextResponse.json({ error: 'Pay item not found' }, { status: 404 })

    const { error: upErr } = await admin.from('employee_pay_items')
      .update({ amount: inc.new_amount, updated_at: new Date().toISOString() }).eq('id', item.id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    // previous_amount is written here, not at scheduling time: what the salary
    // was the moment it changed is the fact worth keeping.
    await admin.from('salary_increments').update({
      status: 'applied', previous_amount: item.amount,
      applied_at: new Date().toISOString(), applied_by: caller.userId,
    }).eq('id', inc.id)

    return NextResponse.json({
      ok: true,
      message: `${inc.employee?.name}: ${inc.item_label} Rs.${Number(item.amount).toLocaleString()} → Rs.${Number(inc.new_amount).toLocaleString()}`,
    })
  }

  if (action === 'cancel') {
    const { incrementId } = body
    const { data: inc } = await admin.from('salary_increments')
      .select('id, status').eq('id', incrementId).eq('vendor_id', caller.vendor.id).single()
    if (!inc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (inc.status === 'applied') {
      return NextResponse.json({ error: 'Already applied — change the salary on the employee instead' }, { status: 400 })
    }
    await admin.from('salary_increments').update({ status: 'cancelled' }).eq('id', inc.id)
    return NextResponse.json({ ok: true, message: 'Scheduled increase cancelled' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
