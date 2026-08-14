import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

const VALID_CATEGORIES = [
  'rent', 'utilities', 'salaries', 'fuel', 'maintenance',
  'repairs', 'bank_charges', 'tax', 'petty_cash',
  // Overheads that usually carry claimable input VAT
  'stationery', 'consumables', 'tools', 'insurance', 'advertising',
  'other',
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
        payment_method: payment_method || 'cash',
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
      .select('id, cash_session_id')
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

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
