import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeExpected } from '@/lib/cash'
import { fetchAllByIds } from '@/lib/fetchAll'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, userId: user.id, role: 'owner', email: user.email || '' }
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { vendor: staffLink.vendor, userId: user.id, role: staffLink.role || 'cashier', email: user.email || '' }
  return null
}

export async function GET(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { vendor } = auth

  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')

  if (date) {
    // Return the session for a specific date (single or null)
    const { data: session } = await admin
      .from('cash_sessions')
      .select('*')
      .eq('vendor_id', vendor.id)
      .eq('session_date', date)
      .maybeSingle()

    // Attach expense_count for this session
    let sessionWithCount = session
      ? { ...session, expense_count: 0 }
      : null

    if (session) {
      const { data: expenseCounts } = await admin
        .from('expenses')
        .select('cash_session_id')
        .eq('vendor_id', vendor.id)
        .eq('cash_session_id', session.id)

      sessionWithCount = {
        ...session,
        expense_count: (expenseCounts || []).length,
      }
    }

    // Carry-forward check: yesterday's counted cash IS today's opening float.
    // Reported, never auto-applied — money figures must not shift on their own,
    // and a silent re-write would also erase the trail of a real discrepancy.
    let carryForward: any = null
    if (session) {
      const { data: prev } = await admin
        .from('cash_sessions')
        .select('session_date, closing_balance')
        .eq('vendor_id', vendor.id)
        .eq('status', 'closed')
        .lt('session_date', session.session_date)
        .not('closing_balance', 'is', null)
        .order('session_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (prev && parseInt(prev.closing_balance) !== parseInt(session.opening_balance || 0)) {
        carryForward = {
          prev_date: prev.session_date,
          prev_closing: parseInt(prev.closing_balance),
          opening: parseInt(session.opening_balance || 0),
          difference: parseInt(prev.closing_balance) - parseInt(session.opening_balance || 0),
        }
      }
    }

    // Corrections made to this day after closing — shown in the daily report
    const { data: corrections } = await admin
      .from('cash_corrections')
      .select('action, actor, detail, created_at')
      .eq('vendor_id', vendor.id)
      .eq('session_date', date)
      .order('created_at')

    // Cash handed to suppliers that day — the daily report lists it beside
    // cash expenses so the drop in the drawer is fully explained
    const { data: supplierPayments } = await admin
      .from('supplier_payments')
      .select('amount, method, reference, payment_date, supplier:suppliers(name)')
      .eq('vendor_id', vendor.id)
      .eq('payment_date', date)
      .eq('method', 'cash')

    // Capital/transfer movements for the day — the daily report explains the
    // drawer with them ("owner put in 50,000", "banked 100,000")
    const { data: movements } = await admin
      .from('cash_movements')
      .select('type, amount, note, created_by')
      .eq('vendor_id', vendor.id)
      .eq('movement_date', date)
      .order('created_at')

    return NextResponse.json({
      session: sessionWithCount,
      carry_forward_mismatch: carryForward,
      corrections: corrections || [],
      supplier_cash_payments: supplierPayments || [],
      cash_movements: movements || [],
    })
  }

  // No date param → last 60 sessions
  const { data: sessions } = await admin
    .from('cash_sessions')
    .select('*')
    .eq('vendor_id', vendor.id)
    .order('session_date', { ascending: false })
    .limit(60)

  // Merge expense counts — fetch only the expenses for the sessions we're about
  // to render (scoped + paginated). The previous all-time fetch hit the 1000-row
  // cap, undercounting expense_count on older sessions as history grew.
  const sessionIds = (sessions || []).map((s: any) => s.id)
  const countMap: Record<string, number> = {}
  if (sessionIds.length > 0) {
    const expenseCountRows = await fetchAllByIds(sessionIds, (ids, from, to) => admin
      .from('expenses')
      .select('cash_session_id')
      .eq('vendor_id', vendor.id)
      .in('cash_session_id', ids)
      .order('id')
      .range(from, to))
    for (const row of expenseCountRows) {
      const sid = row.cash_session_id as string
      countMap[sid] = (countMap[sid] || 0) + 1
    }
  }

  const sessionsWithCounts = (sessions || []).map((s: any) => ({
    ...s,
    expense_count: countMap[s.id] || 0,
  }))

  return NextResponse.json({ sessions: sessionsWithCounts })
}

/**
 * Expected cash in the drawer for a session, computed from LIVE data so a
 * closed session re-checks correctly after a late correction.
 *
 *   expected = opening + cash received − cash expenses + adjustments in/out
 *
 * Cash received comes from the PAYMENTS ledger (not sales.total): invoice
 * totals counted unpaid credit sales as cash, missed split payments, ignored
 * credit collections on older invoices, and never subtracted cash refunds.
 */
export async function POST(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { vendor, userId } = auth

  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body

  // ── open ──────────────────────────────────────────────────────────────────────
  if (action === 'recompute' || action === 'adjust' || action === 'set_opening' || action === 'accept_variance') {
    // ── Post-close corrections ────────────────────────────────────────────
    // A closed session can still be made truthful: record an expense or a cash
    // receipt that was forgotten on the day, fix a wrong opening balance, or
    // accept the difference as a genuine short/over with a reason. Every
    // correction recomputes expected cash and variance from live data.
    const { sessionId } = body
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

    // Separation of duties: whoever counts the drawer must NOT be able to
    // adjust their own difference away. Cashiers count and close; only a
    // supervisor corrects afterwards. (recompute is a pure recalculation from
    // existing records — it changes no figures by hand, so it stays open.)
    if (action !== 'recompute' && auth.role !== 'owner' && auth.role !== 'manager') {
      return NextResponse.json({ error: 'Only the owner or a manager can correct a closed session' }, { status: 403 })
    }

    const { data: session } = await admin
      .from('cash_sessions').select('*').eq('id', sessionId).eq('vendor_id', vendor.id).single()
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    const patch: any = {}

    if (action === 'adjust') {
      // Cash that physically moved but was never recorded on the day:
      // kind 'in'  = money received (e.g. a cash sale entered a day late)
      // kind 'out' = money paid out that isn't an expense record
      const amt = Math.round(Number(body.amount))
      if (!Number.isFinite(amt) || amt <= 0) return NextResponse.json({ error: 'amount must be a positive whole number' }, { status: 400 })
      const kind = body.kind === 'out' ? 'out' : 'in'
      const note = String(body.note || '').trim()
      if (kind === 'in') patch.adjustment_in = parseInt(session.adjustment_in || 0) + amt
      else patch.adjustment_out = parseInt(session.adjustment_out || 0) + amt
      patch.adjustment_note = [session.adjustment_note, `${kind === 'in' ? '+' : '-'}Rs.${amt}${note ? ' ' + note : ''}`].filter(Boolean).join(' · ')
    }

    if (action === 'set_opening') {
      const amt = Math.round(Number(body.opening_balance))
      if (!Number.isFinite(amt) || amt < 0) return NextResponse.json({ error: 'opening_balance must be a non-negative whole number' }, { status: 400 })
      patch.opening_balance = amt
    }

    if (action === 'accept_variance') {
      patch.variance_accepted = true
      patch.variance_reason = String(body.reason || '').trim() || 'Accepted without reason'
    }

    // Recompute from live data using the patched values
    const merged = { ...session, ...patch }
    const { expectedCash, cashExpenses } = await computeExpected(admin, vendor.id, merged)
    patch.expected_cash = expectedCash
    patch.cash_expenses = cashExpenses
    if (merged.closing_balance != null) {
      patch.variance = parseInt(merged.closing_balance) - expectedCash
      // A correction that resolves the difference clears any earlier "accepted" flag
      if (action !== 'accept_variance' && patch.variance === 0) { patch.variance_accepted = false; patch.variance_reason = null }
    }

    const { error } = await admin.from('cash_sessions').update(patch).eq('id', sessionId).eq('vendor_id', vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Audit every hand-made correction — a post-close adjustment is exactly how
    // a cash shortage could be papered over, so who/when/what is recorded and
    // surfaced in the daily report. 'recompute' is arithmetic only, not logged.
    if (action !== 'recompute') {
      await admin.from('cash_corrections').insert({
        vendor_id: vendor.id,
        session_id: sessionId,
        session_date: session.session_date,
        actor: auth.email || auth.userId,
        action,
        detail: {
          amount: body.amount ?? body.opening_balance ?? null,
          kind: body.kind ?? null,
          note: body.note ?? body.reason ?? null,
          variance_before: session.variance ?? null,
          variance_after: patch.variance ?? null,
          opening_before: session.opening_balance ?? null,
          opening_after: patch.opening_balance ?? session.opening_balance ?? null,
        },
      }).then(() => {}, () => {})
    }

    return NextResponse.json({ ok: true, expected_cash: expectedCash, cash_expenses: cashExpenses, variance: patch.variance })
  }

  if (action === 'open') {
    const { session_date, opening_balance } = body

    if (!session_date || !/^\d{4}-\d{2}-\d{2}$/.test(session_date)) {
      return NextResponse.json({ error: 'Invalid session_date — expected YYYY-MM-DD' }, { status: 400 })
    }

    // Never start a new day on top of an unclosed one: the older session's
    // closing balance is what carries forward, so opening without it makes
    // BOTH days wrong (the old day short, the new day over by the same amount).
    const { data: stillOpen } = await admin
      .from('cash_sessions')
      .select('id, session_date')
      .eq('vendor_id', vendor.id)
      .eq('status', 'open')
      .lt('session_date', session_date)
      .order('session_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (stillOpen) {
      return NextResponse.json({
        error: `The drawer from ${stillOpen.session_date} was never closed. Close it first — its counted cash becomes today's opening balance.`,
        blocking_session: stillOpen,
      }, { status: 409 })
    }

    // Opening balance = whatever the operator confirms. If not supplied, carry
    // forward the cash left in the drawer overnight — the most recent CLOSED
    // session's counted closing balance becomes today's opening float.
    let openingBal: number
    if (typeof opening_balance === 'number') {
      openingBal = opening_balance
    } else {
      const { data: prev } = await admin
        .from('cash_sessions')
        .select('closing_balance')
        .eq('vendor_id', vendor.id)
        .eq('status', 'closed')
        .lt('session_date', session_date)
        .not('closing_balance', 'is', null)
        .order('session_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      openingBal = prev && prev.closing_balance != null ? parseInt(prev.closing_balance) : 0
    }

    // Check for duplicate
    const { data: existing } = await admin
      .from('cash_sessions')
      .select('id')
      .eq('vendor_id', vendor.id)
      .eq('session_date', session_date)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'A session already exists for this date' }, { status: 409 })
    }

    const { data: session, error } = await admin
      .from('cash_sessions')
      .insert({
        vendor_id: vendor.id,
        session_date,
        opening_balance: openingBal,
        status: 'open',
        opened_by: userId,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ ok: true, session })
  }

  // ── close ─────────────────────────────────────────────────────────────────────
  if (action === 'close') {
    const { sessionId, closing_balance, notes } = body

    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    if (typeof closing_balance !== 'number' || closing_balance < 0) {
      return NextResponse.json({ error: 'closing_balance must be a non-negative number' }, { status: 400 })
    }

    // Fetch session and verify ownership
    const { data: session } = await admin
      .from('cash_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('vendor_id', vendor.id)
      .single()

    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    if (session.status !== 'open') return NextResponse.json({ error: 'Session is not open' }, { status: 400 })

    const { expectedCash, cashExpenses } = await computeExpected(admin, vendor.id, session)
    const variance = closing_balance - expectedCash

    const updateData: any = {
      closing_balance,
      expected_cash: expectedCash,
      cash_expenses: cashExpenses,
      variance,
      status: 'closed',
      closed_by: userId,
      closed_at: new Date().toISOString(),
    }
    if (notes !== undefined) updateData.notes = notes

    const { error } = await admin
      .from('cash_sessions')
      .update(updateData)
      .eq('id', sessionId)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ ok: true, expected_cash: expectedCash, cash_expenses: cashExpenses, variance })
  }

  // ── reopen ────────────────────────────────────────────────────────────────────
  if (action === 'reopen') {
    const { sessionId } = body

    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    // Re-opening clears a counted result — same separation of duties as corrections
    if (auth.role !== 'owner' && auth.role !== 'manager') {
      return NextResponse.json({ error: 'Only the owner or a manager can re-open a closed session' }, { status: 403 })
    }

    const { data: session } = await admin
      .from('cash_sessions')
      .select('id, status')
      .eq('id', sessionId)
      .eq('vendor_id', vendor.id)
      .single()

    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    if (session.status !== 'closed') return NextResponse.json({ error: 'Session is not closed' }, { status: 400 })

    const { error } = await admin
      .from('cash_sessions')
      .update({
        status: 'open',
        closed_by: null,
        closed_at: null,
        closing_balance: null,
        expected_cash: null,
        cash_expenses: null,
        variance: null,
      })
      .eq('id', sessionId)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
