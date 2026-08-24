import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ─────────────────────────────────────────────────────────────────────────────
// Workshop job-close guard: "does this job's claim still have unclassified
// shortfalls?" Workshop Pulse calls this before closing an insurance job —
// a job must not close while money the insurer didn't pay sits undecided.
//
// Same auth as /api/workshop/sales: bearer token of an active workshop staff
// member (user_roles). Matches claims by workshop_job_ref, falling back to
// vehicle + open status so jobs invoiced before job-ref stamping still match.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
  'https://workshop-pulse.vercel.app',
  'http://localhost:3000',
  'http://localhost:3719',
])
function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://workshop-pulse.vercel.app',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

export async function GET(req: NextRequest) {
  const headers = corsHeaders(req)
  const json = (body: any, status = 200) => NextResponse.json(body, { status, headers })

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return json({ error: 'Not authenticated' }, 401)

  const admin = createAdminClient()
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user?.email) return json({ error: 'Invalid session' }, 401)
  const { data: staffRow } = await admin
    .from('user_roles').select('role, is_active')
    .eq('email', user.email.toLowerCase()).eq('is_active', true).single()
  if (!staffRow) return json({ error: 'Not workshop staff' }, 403)

  const url = new URL(req.url)
  const jobRef = url.searchParams.get('jobRef')?.trim()
  const vehicle = url.searchParams.get('vehicle')?.trim()
  if (!jobRef && !vehicle) return json({ error: 'jobRef or vehicle required' }, 400)

  // The workshop entities' vendor scopes the lookup
  const { data: entity } = await admin.from('invoice_entities')
    .select('vendor_id').eq('serial_qqqq', 'REPR').single()
  if (!entity) return json({ claims: [], unclassifiedTotal: 0 })

  let q = admin.from('insurance_claims')
    .select('id, claim_no, vehicle_no, status')
    .eq('vendor_id', entity.vendor_id)
  if (jobRef && vehicle) q = q.or(`workshop_job_ref.eq.${jobRef},and(vehicle_no.ilike.${vehicle},status.neq.closed)`)
  else if (jobRef) q = q.eq('workshop_job_ref', jobRef)
  else q = q.ilike('vehicle_no', vehicle!).neq('status', 'closed')
  const { data: claims } = await q

  const out: any[] = []
  let unclassifiedTotal = 0
  for (const c of (claims || [])) {
    const { count } = await admin.from('claim_shortfalls')
      .select('*', { count: 'exact', head: true })
      .eq('claim_id', c.id).is('classification', null)
    out.push({ claimNo: c.claim_no, vehicle: c.vehicle_no, status: c.status, unclassified: count || 0 })
    unclassifiedTotal += count || 0
  }
  return json({ claims: out, unclassifiedTotal })
}
