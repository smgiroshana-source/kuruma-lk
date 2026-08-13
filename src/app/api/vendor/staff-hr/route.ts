import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ─────────────────────────────────────────────────────────────────────────────
// WHEEL MART Staff/HR — stage 1: registry, pay items, attendance, advances.
//
// Visibility model (enforced HERE, server-side):
//   owner    → everything.
//   manager  → employee profiles, attendance, advances, and ONLY pay items
//              flagged visible_to_office. Hidden items are omitted from the
//              response entirely — never sent, so nothing to "unhide".
//   cashier  → no access at all.
// Pay item editing is owner-only, and every change is audit-logged.
// ─────────────────────────────────────────────────────────────────────────────

async function getCaller() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, role: 'owner', email: user.email || '', scope: 'both' }
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { vendor: staffLink.vendor, role: staffLink.role || 'cashier', email: user.email || '', scope: staffLink.branch_scope || 'shop' }
  return null
}

const audit = (admin: any, vendorId: string, actor: string, action: string, employeeId: string | null, detail: any) =>
  admin.from('staff_audit').insert({ vendor_id: vendorId, actor, action, employee_id: employeeId, detail }).then(() => {}, () => {})

export async function GET(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { vendor, role, email, scope } = caller
  if (role !== 'owner' && role !== 'manager') return NextResponse.json({ error: 'No access' }, { status: 403 })

  const admin = createAdminClient()
  const url = new URL(req.url)

  // Branch scope: a login limited to one side of the business only ever
  // receives that side's people (owner and 'both' logins see everything)
  let empQuery = admin.from('employees').select('*').eq('vendor_id', vendor.id)
  if (scope === 'shop' || scope === 'workshop') empQuery = empQuery.eq('branch', scope)
  const { data: employees } = await empQuery.order('branch').order('name')


  // Pay items: owner sees all; manager only office-visible ones
  let itemsQuery = admin.from('employee_pay_items').select('*').eq('active', true)
  if (role !== 'owner') itemsQuery = itemsQuery.eq('visible_to_office', true)
  const { data: payItems } = await itemsQuery
  const empIds = new Set((employees || []).map((e: any) => e.id))
  const itemsByEmp: Record<string, any[]> = {}
  for (const it of (payItems || [])) {
    if (!empIds.has(it.employee_id)) continue
    ;(itemsByEmp[it.employee_id] = itemsByEmp[it.employee_id] || []).push(it)
  }

  // Attendance for a date (or range) if requested
  const date = url.searchParams.get('date')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  let attendance: any[] = []
  if (date || (from && to)) {
    let q = admin.from('staff_attendance').select('*')
    if (date) q = q.eq('date', date)
    else q = q.gte('date', from!).lte('date', to!)
    const { data } = await q
    attendance = (data || []).filter((a: any) => empIds.has(a.employee_id))
  }

  const { data: advancesRaw } = await admin.from('staff_advances')
    .select('*').eq('vendor_id', vendor.id).order('date', { ascending: false }).limit(300)

  return NextResponse.json({
    role,
    scope,
    employees: (employees || []).map((e: any) => ({ ...e, pay_items: itemsByEmp[e.id] || [] })),
    attendance,
    advances: advancesRaw || [],
    caller: email,
  })
}

export async function POST(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { vendor, role, email, scope } = caller
  if (role !== 'owner' && role !== 'manager') return NextResponse.json({ error: 'No access' }, { status: 403 })
  const inScope = (branch?: string | null) => scope === 'both' || !branch || branch === scope

  const admin = createAdminClient()

  // ── ID copy upload (multipart) → staff-docs bucket, plain public URL
  //    (SL office practice: ID copies live in an ordinary office file) ──
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    try {
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      if (!file || !file.size) return NextResponse.json({ error: 'No file' }, { status: 400 })
      if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
      const path = `staff-ids/${vendor.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
      const buf = Buffer.from(await file.arrayBuffer())
      const { error: upErr } = await admin.storage.from('staff-docs').upload(path, buf, { contentType: file.type || 'image/jpeg', upsert: false })
      if (upErr) return NextResponse.json({ error: 'Upload failed: ' + upErr.message }, { status: 500 })
      const { data: pub } = admin.storage.from('staff-docs').getPublicUrl(path)
      return NextResponse.json({ url: pub.publicUrl })
    } catch (e: any) {
      return NextResponse.json({ error: 'Upload failed: ' + (e?.message || 'unknown') }, { status: 500 })
    }
  }

  const body = await req.json()
  const { action } = body

  // ── Create / edit employee profile (owner + manager/office) ──
  if (action === 'upsert_employee') {
    const { id, name, nic, phone, address, branch, join_date, pay_type, active, id_photos } = body
    if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

    // NIC identifies the person — required, and unique per vendor so the same
    // employee can never be registered twice (names repeat; ID numbers don't).
    const nicNorm = String(nic || '').trim().toUpperCase().replace(/\s+/g, '')
    if (!nicNorm) return NextResponse.json({ error: 'NIC / ID number is required' }, { status: 400 })
    const { data: clash } = await admin.from('employees')
      .select('id, name, active')
      .eq('vendor_id', vendor.id)
      .ilike('nic', nicNorm)
      .maybeSingle()
    if (clash && clash.id !== id) {
      return NextResponse.json({
        error: `That NIC is already registered to ${clash.name}${clash.active ? '' : ' (inactive)'} — open that record instead of creating a new one.`,
      }, { status: 409 })
    }
    // ID copies are COMPULSORY (owner rule): every employee record must carry
    // at least one NIC/ID photo (plain URLs in the staff-docs bucket)
    const photoPaths = Array.isArray(id_photos)
      ? id_photos.filter((p: any) => typeof p === 'string' && p.includes('/staff-docs/'))
      : undefined
    if (!inScope(branch === 'workshop' ? 'workshop' : 'shop')) {
      return NextResponse.json({ error: `Your access covers the ${scope} only` }, { status: 403 })
    }
    const rec: any = {
      name: name.trim(), nic: nicNorm, phone: phone?.trim() || null,
      address: address?.trim() || null,
      branch: branch === 'workshop' ? 'workshop' : 'shop',
      join_date: join_date || null,
      pay_type: ['monthly', 'daily', 'contract'].includes(pay_type) ? pay_type : 'monthly',
      active: active !== false,
      updated_at: new Date().toISOString(),
    }
    if (photoPaths !== undefined) rec.id_photos = photoPaths
    if (!id && (!photoPaths || photoPaths.length === 0)) {
      return NextResponse.json({ error: 'At least one ID copy photo is required' }, { status: 400 })
    }
    if (id && photoPaths !== undefined && photoPaths.length === 0) {
      return NextResponse.json({ error: 'An employee must keep at least one ID copy photo' }, { status: 400 })
    }
    if (id) {
      const { data: existing } = await admin.from('employees').select('id').eq('id', id).eq('vendor_id', vendor.id).single()
      if (!existing) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
      const { data, error } = await admin.from('employees').update(rec).eq('id', id).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      audit(admin, vendor.id, email, 'employee_updated', id, { name: rec.name })
      return NextResponse.json({ employee: data })
    }
    const { data, error } = await admin.from('employees')
      .insert({ ...rec, vendor_id: vendor.id, created_by: email }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    audit(admin, vendor.id, email, 'employee_created', data.id, { name: rec.name })
    return NextResponse.json({ employee: data })
  }

  // ── Pay items (OWNER ONLY — the money) ──
  if (action === 'set_pay_items') {
    if (role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 })
    const { employee_id, items } = body
    if (!employee_id || !Array.isArray(items)) return NextResponse.json({ error: 'employee_id and items required' }, { status: 400 })
    const { data: emp } = await admin.from('employees').select('id').eq('id', employee_id).eq('vendor_id', vendor.id).single()
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    const shape = (it: any) => ({
      employee_id,
      kind: ['base', 'allowance', 'commission_rate', 'profit_rate', 'epf', 'other'].includes(it.kind) ? it.kind : 'other',
      label: String(it.label).trim(),
      amount: Math.max(0, Number(it.amount)),
      unit: it.unit === 'percent' ? 'percent' : 'rs',
      period: ['monthly', 'daily', 'per_event'].includes(it.period) ? it.period : 'monthly',
      half_day_policy: ['half', 'none', 'full'].includes(it.half_day_policy) ? it.half_day_policy : 'half',
      visible_to_office: it.visible_to_office === true,
      active: true,
      updated_at: new Date().toISOString(),
    })
    const valid = items.filter((it: any) => it.label?.trim() && Number.isFinite(Number(it.amount)))
    const existingRows = valid.filter((it: any) => it.id).map((it: any) => ({ id: it.id, ...shape(it) }))
    const newRows = valid.filter((it: any) => !it.id).map(shape)

    // Refuse to silently wipe a configured pay setup. An empty submission is
    // only honoured when the client says the owner deliberately removed every
    // item in this editing session — otherwise a stale form would erase salaries.
    const { data: currentActive } = await admin
      .from('employee_pay_items').select('id').eq('employee_id', employee_id).eq('active', true)
    if (valid.length === 0 && (currentActive || []).length > 0 && body.clear_all !== true) {
      return NextResponse.json({ error: 'Pay items were not sent — nothing changed. Reopen the record and try again.' }, { status: 409 })
    }

    // Replace-set: deactivate everything, then (re)activate what was submitted.
    // INSERT and UPSERT run separately — a bulk write mixing rows with and
    // without `id` makes PostgREST send id:null for the new ones, which the
    // not-null primary key rejects.
    await admin.from('employee_pay_items').update({ active: false, updated_at: new Date().toISOString() }).eq('employee_id', employee_id)
    if (existingRows.length > 0) {
      const { error } = await admin.from('employee_pay_items').upsert(existingRows)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (newRows.length > 0) {
      const { error } = await admin.from('employee_pay_items').insert(newRows)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }
    audit(admin, vendor.id, email, 'pay_items_set', employee_id, { count: valid.length, labels: valid.map((r: any) => r.label) })
    return NextResponse.json({ ok: true })
  }

  // ── Attendance (owner + manager) ──
  if (action === 'mark_attendance') {
    const { date, marks } = body
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(marks)) {
      return NextResponse.json({ error: 'date and marks required' }, { status: 400 })
    }
    let empQ = admin.from('employees').select('id, name, join_date').eq('vendor_id', vendor.id)
    if (scope === 'shop' || scope === 'workshop') empQ = empQ.eq('branch', scope)
    const { data: emps } = await empQ
    // Nobody can be marked before the day they joined
    const joinById = new Map((emps || []).map((e: any) => [e.id, e.join_date]))
    const tooEarly = marks.filter((m: any) => {
      const jd = joinById.get(m.employee_id)
      return jd && date < jd
    })
    if (tooEarly.length > 0) {
      const names = (emps || []).filter((e: any) => tooEarly.some((m: any) => m.employee_id === e.id)).map((e: any) => `${e.name} (joined ${e.join_date})`)
      return NextResponse.json({ error: `Not employed on ${date}: ${names.join(', ')}` }, { status: 400 })
    }
    const valid = new Set((emps || []).map((e: any) => e.id))
    const rows = marks
      .filter((m: any) => valid.has(m.employee_id) && ['present', 'half', 'absent'].includes(m.status))
      .map((m: any) => ({ employee_id: m.employee_id, date, status: m.status, marked_by: email }))
    if (rows.length === 0) return NextResponse.json({ error: 'No valid marks' }, { status: 400 })
    const { error } = await admin.from('staff_attendance').upsert(rows, { onConflict: 'employee_id,date' })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, saved: rows.length })
  }

  // ── Advances (owner + manager; drawer/bank advances create an expense row so
  //    cash reconciliation and the daily report stay truthful) ──
  if (action === 'add_advance') {
    const { employee_id, amount, date, source, note } = body
    const amt = Math.round(Number(amount))
    if (!employee_id || !isFinite(amt) || amt <= 0) return NextResponse.json({ error: 'Valid employee and amount required' }, { status: 400 })
    const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10)
    const src = ['drawer', 'bank', 'owner'].includes(source) ? source : 'drawer'
    const { data: emp } = await admin.from('employees').select('id, name, branch').eq('id', employee_id).eq('vendor_id', vendor.id).single()
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    if (!inScope(emp.branch)) return NextResponse.json({ error: `Your access covers the ${scope} only` }, { status: 403 })

    let expenseId: string | null = null
    if (src !== 'owner') {
      // Link to the open cash session if there is one (drawer money must reconcile)
      let sessionId: string | null = null
      if (src === 'drawer') {
        const { data: openSession } = await admin.from('cash_sessions')
          .select('id').eq('vendor_id', vendor.id).is('closed_at', null)
          .order('opened_at', { ascending: false }).limit(1)
        sessionId = openSession?.[0]?.id || null
      }
      const { data: exp } = await admin.from('expenses').insert({
        vendor_id: vendor.id, expense_date: d, category: 'salaries',
        description: `Staff advance — ${emp.name}`,
        amount: amt, payment_method: src === 'drawer' ? 'cash' : 'bank',
        cash_session_id: sessionId, created_by: email,
      }).select('id').single()
      expenseId = exp?.id || null
    }

    const { data: adv, error } = await admin.from('staff_advances').insert({
      employee_id, vendor_id: vendor.id, amount: amt, date: d, source: src,
      note: note?.trim() || null, expense_id: expenseId, entered_by: email,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    audit(admin, vendor.id, email, 'advance_added', employee_id, { amount: amt, source: src })
    return NextResponse.json({ advance: adv })
  }

  if (action === 'delete_advance') {
    if (role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 })
    const { id } = body
    const { data: adv } = await admin.from('staff_advances').select('*').eq('id', id).eq('vendor_id', vendor.id).single()
    if (!adv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (adv.settled_in_run) return NextResponse.json({ error: 'Already settled in a payroll run' }, { status: 400 })
    if (adv.expense_id) await admin.from('expenses').delete().eq('id', adv.expense_id).eq('vendor_id', vendor.id)
    await admin.from('staff_advances').delete().eq('id', id)
    audit(admin, vendor.id, email, 'advance_deleted', adv.employee_id, { amount: adv.amount })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
