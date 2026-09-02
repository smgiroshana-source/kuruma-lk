import { NextRequest, NextResponse } from 'next/server'
import { roleAllows, forbidden, pgSafe, isUUID, MAX_UPLOAD_BYTES } from '@/lib/security'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeSessionForDate } from '@/lib/cash'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, userId: user.id, callerRole: 'owner' as string }
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { vendor: staffLink.vendor, userId: user.id, callerRole: (staffLink.role || 'cashier') as string }
  return null
}

// What the operator can pick (see CATEGORY_LABELS in TabCash), plus every
// legacy value already sitting in the table — old rows must keep validating.
// 'salaries' is written by Staff/HR, never chosen by hand: payroll is recorded
// once, against a person, so it can't be double-counted here.
const VALID_CATEGORIES = [
  'grocery', 'rent', 'electricity', 'water', 'stationery',
  'internet', 'transport', 'maintenance', 'commission', 'other',
  // legacy / system-written ('repairs' folded into maintenance in the picker)
  'repairs', 'utilities', 'salaries', 'fuel', 'bank_charges', 'tax', 'petty_cash',
  'consumables', 'tools', 'insurance', 'advertising',
] as const

type ExpenseCategory = typeof VALID_CATEGORIES[number]

function isValidCategory(cat: string): cat is ExpenseCategory {
  return (VALID_CATEGORIES as readonly string[]).includes(cat)
}

export async function GET(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { vendor } = auth

  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const month = searchParams.get('month')
  const cashSessionId = searchParams.get('cash_session_id')

  let query = admin
    .from('expenses')
    .select('*')
    .eq('vendor_id', vendor.id)
    .order('expense_date', { ascending: false })

  if (date) {
    query = query.eq('expense_date', date)
  } else if (month) {
    // LIKE '2026-06%'
    query = query.gte('expense_date', `${month}-01`).lte('expense_date', `${month}-31`)
  } else if (cashSessionId) {
    query = query.eq('cash_session_id', cashSessionId)
  } else {
    query = query.limit(100)
  }

  const { data: expenses, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ expenses: expenses || [] })
}

export async function POST(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { vendor, userId } = auth

  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body
  // Destructive actions are owner/manager only. Any active login — a cashier
  // included — could do these before the 2026-09-02 review.
  const DESTRUCTIVE = new Set(['delete'])
  if (DESTRUCTIVE.has(action) && !roleAllows((auth as any).callerRole, ['owner', 'manager'])) return forbidden(action, ['owner', 'manager'])

  // ── create ────────────────────────────────────────────────────────────────────
  if (action === 'create') {
    const {
      expense_date,
      category,
      description,
      amount,
      payment_method,
      reference,
      cash_session_id,
      // Input VAT on overheads/consumables — Schedule 02 needs the same
      // details as a stock purchase, so they're validated together below.
      supplier_name,
      supplier_tin,
      supplier_invoice_no,
      supplier_invoice_date,
      input_vat,
    } = body

    // Validate required fields
    if (!expense_date || !/^\d{4}-\d{2}-\d{2}$/.test(expense_date)) {
      return NextResponse.json({ error: 'Invalid expense_date — expected YYYY-MM-DD' }, { status: 400 })
    }
    if (!category || !isValidCategory(category)) {
      return NextResponse.json({
        error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
      }, { status: 400 })
    }
    if (!description || !description.trim()) {
      return NextResponse.json({ error: 'description is required' }, { status: 400 })
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive integer (LKR)' }, { status: 400 })
    }

    // Cash, online or cheque. "Bank" was ambiguous — a cheque is a bank
    // payment too — so a transfer is 'online'. Legacy 'bank'/'card' rows are
    // still accepted and display as Online. Money leaving outside the till
    // must carry its reference (cheque number, or the bank's 8-digit
    // confirmation number) or it can never be matched to the statement.
    const method = payment_method || 'cash'
    if (!['cash', 'online', 'cheque', 'bank', 'card'].includes(method)) {
      return NextResponse.json({ error: 'Payment must be cash, online or cheque' }, { status: 400 })
    }
    if (method !== 'cash' && !String(reference || '').trim()) {
      return NextResponse.json({
        error: method === 'cheque' ? 'Enter the cheque number' : 'Enter the 8-digit bank confirmation number',
      }, { status: 400 })
    }

    // Input VAT is only claimable against a valid tax invoice from a
    // VAT-registered supplier — no invoice number, no claim.
    const claimVat = Math.round(Number(input_vat) || 0)
    if (claimVat < 0) return NextResponse.json({ error: 'Input VAT cannot be negative' }, { status: 400 })
    if (claimVat > 0) {
      if (!supplier_invoice_no || !String(supplier_invoice_no).trim()) {
        return NextResponse.json({ error: 'To claim input VAT, enter the supplier\'s tax invoice number' }, { status: 400 })
      }
      if (!supplier_tin || !/^\d{9}$/.test(String(supplier_tin).trim())) {
        return NextResponse.json({ error: 'To claim input VAT, enter the supplier\'s 9-digit TIN' }, { status: 400 })
      }
      if (claimVat >= Math.round(amount)) {
        return NextResponse.json({ error: 'Input VAT must be less than the amount paid' }, { status: 400 })
      }
    }

    // If cash_session_id provided, verify it belongs to this vendor
    if (cash_session_id) {
      const { data: session } = await admin
        .from('cash_sessions')
        .select('id')
        .eq('id', cash_session_id)
        .eq('vendor_id', vendor.id)
        .maybeSingle()

      if (!session) {
        return NextResponse.json({ error: 'cash_session_id not found or does not belong to this vendor' }, { status: 400 })
      }
    }

    const { data: expense, error } = await admin
      .from('expenses')
      .insert({
        vendor_id: vendor.id,
        expense_date,
        category,
        description: description.trim(),
        amount: Math.round(amount),
        payment_method: method,
        reference: reference || null,
        cash_session_id: cash_session_id || null,
        supplier_name:         supplier_name ? String(supplier_name).trim() : null,
        supplier_tin:          claimVat > 0 ? String(supplier_tin).trim() : (supplier_tin || null),
        supplier_invoice_no:   supplier_invoice_no ? String(supplier_invoice_no).trim() : null,
        supplier_invoice_date: supplier_invoice_date || null,
        input_vat:             claimVat,
        created_by: userId,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Keep that day's drawer arithmetic right — including a cash expense
    // entered after the day was closed, which is the usual way a phantom
    // shortage appears.
    if (method === 'cash') {
      await recomputeSessionForDate(admin, vendor.id, expense_date)
    }

    return NextResponse.json({ ok: true, expense })
  }

  // ── set_vat ───────────────────────────────────────────────────────────────────
  // Attach (or correct) the tax-invoice details on an expense already recorded.
  // The bill often turns up after the money went out, and a cashier paying the
  // electricity has no reason to be typing TINs — the owner tidies it up later.
  if (action === 'set_vat') {
    const { expenseId, supplier_name, supplier_tin, supplier_invoice_no, supplier_invoice_date, input_vat } = body
    if (!expenseId) return NextResponse.json({ error: 'expenseId required' }, { status: 400 })

    const { data: expense } = await admin
      .from('expenses').select('id, amount').eq('id', expenseId).eq('vendor_id', vendor.id).single()
    if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })

    const claimVat = Math.round(Number(input_vat) || 0)
    if (claimVat < 0) return NextResponse.json({ error: 'Input VAT cannot be negative' }, { status: 400 })
    if (claimVat > 0) {
      if (!supplier_invoice_no || !String(supplier_invoice_no).trim()) {
        return NextResponse.json({ error: 'To claim input VAT, enter the supplier\'s tax invoice number' }, { status: 400 })
      }
      if (!supplier_tin || !/^\d{9}$/.test(String(supplier_tin).trim())) {
        return NextResponse.json({ error: 'To claim input VAT, enter the supplier\'s 9-digit TIN' }, { status: 400 })
      }
      if (claimVat >= expense.amount) {
        return NextResponse.json({ error: 'Input VAT must be less than the amount paid' }, { status: 400 })
      }
    }

    const { error } = await admin.from('expenses').update({
      supplier_name:         supplier_name ? String(supplier_name).trim() : null,
      supplier_tin:          supplier_tin ? String(supplier_tin).trim() : null,
      supplier_invoice_no:   supplier_invoice_no ? String(supplier_invoice_no).trim() : null,
      supplier_invoice_date: supplier_invoice_date || null,
      input_vat:             claimVat,
    }).eq('id', expenseId).eq('vendor_id', vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ ok: true })
  }

  // ── delete ────────────────────────────────────────────────────────────────────
  if (action === 'delete') {
    const { expenseId } = body

    if (!expenseId) return NextResponse.json({ error: 'expenseId required' }, { status: 400 })

    // Fetch expense and verify ownership
    const { data: expense } = await admin
      .from('expenses')
      .select('id, cash_session_id, expense_date, payment_method')
      .eq('id', expenseId)
      .eq('vendor_id', vendor.id)
      .single()

    if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })

    // If linked to a session, verify that session is still open
    if (expense.cash_session_id) {
      const { data: session } = await admin
        .from('cash_sessions')
        .select('status')
        .eq('id', expense.cash_session_id)
        .eq('vendor_id', vendor.id)
        .single()

      if (session && session.status !== 'open') {
        return NextResponse.json({ error: 'Cannot delete an expense linked to a closed session' }, { status: 400 })
      }
    }

    const { error } = await admin
      .from('expenses')
      .delete()
      .eq('id', expenseId)
      .eq('vendor_id', vendor.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    if ((expense as any).payment_method === 'cash') {
      await recomputeSessionForDate(admin, vendor.id, (expense as any).expense_date)
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
