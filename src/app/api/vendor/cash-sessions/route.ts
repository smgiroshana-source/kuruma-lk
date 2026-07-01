import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllByIds } from '@/lib/fetchAll'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, userId: user.id }
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { vendor: staffLink.vendor, userId: user.id }
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

    return NextResponse.json({ session: sessionWithCount })
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

export async function POST(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { vendor, userId } = auth

  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body

  // ── open ──────────────────────────────────────────────────────────────────────
  if (action === 'open') {
    const { session_date, opening_balance } = body

    if (!session_date || !/^\d{4}-\d{2}-\d{2}$/.test(session_date)) {
      return NextResponse.json({ error: 'Invalid session_date — expected YYYY-MM-DD' }, { status: 400 })
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

    const sessionDate: string = session.session_date
    const openingBal: number = parseInt(session.opening_balance || 0)

    // 1. Sum cash sales for this session_date (Asia/Colombo time, UTC+5:30)
    const dateStart = `${sessionDate}T00:00:00+05:30`
    const dateEnd   = `${sessionDate}T23:59:59+05:30`
    const { data: salesRows } = await admin
      .from('sales')
      .select('total')
      .eq('vendor_id', vendor.id)
      .eq('payment_method', 'cash')
      .is('voided_at', null)
      .gte('created_at', new Date(dateStart).toISOString())
      .lte('created_at', new Date(dateEnd).toISOString())

    const cashSales = (salesRows || []).reduce((sum: number, s: any) => sum + parseInt(s.total || 0), 0)

    // 2. Sum cash expenses for this session_date
    const { data: expenseRows } = await admin
      .from('expenses')
      .select('amount')
      .eq('vendor_id', vendor.id)
      .eq('expense_date', sessionDate)
      .eq('payment_method', 'cash')

    const cashExpenses = (expenseRows || []).reduce((sum: number, e: any) => sum + parseInt(e.amount || 0), 0)

    // 3. Compute expected_cash and variance
    const expectedCash = openingBal + cashSales - cashExpenses
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
