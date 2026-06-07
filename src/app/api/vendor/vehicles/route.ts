import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const VALID_FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric', 'other'] as const
type FuelType = (typeof VALID_FUEL_TYPES)[number]

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
  const result = await getVendor()
  if (!result) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor } = result

  const admin = createAdminClient()
  const url = new URL(req.url)
  const plate_no = url.searchParams.get('plate_no')
  const fleet_account_id = url.searchParams.get('fleet_account_id')

  let query = admin
    .from('customer_vehicles')
    .select('*, fleet_account:fleet_accounts(company_name)')
    .eq('vendor_id', vendor.id)
    .eq('is_active', true)
    .order('plate_no', { ascending: true })

  if (plate_no) {
    query = query.ilike('plate_no', `%${plate_no}%`)
  }

  if (fleet_account_id) {
    query = query.eq('fleet_account_id', fleet_account_id)
  }

  const { data: rows, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Flatten fleet_account join → fleet_company field
  const vehicles = (rows || []).map((v: any) => {
    const { fleet_account, ...rest } = v
    return {
      ...rest,
      fleet_company: (fleet_account as { company_name: string } | null)?.company_name ?? null,
    }
  })

  return NextResponse.json({ vehicles })
}

export async function POST(req: NextRequest) {
  const result = await getVendor()
  if (!result) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor } = result

  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body

  if (action === 'create') {
    const {
      plate_no, make, model, year, color,
      fuel_type, engine_no, chassis_no, notes,
      fleet_account_id, customer_id,
    } = body

    if (!plate_no?.trim()) {
      return NextResponse.json({ error: 'plate_no is required' }, { status: 400 })
    }

    const normalizedPlate = plate_no.trim().toUpperCase()

    // Validate fuel_type if provided
    if (fuel_type != null && !VALID_FUEL_TYPES.includes(fuel_type as FuelType)) {
      return NextResponse.json(
        { error: `fuel_type must be one of: ${VALID_FUEL_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Check for duplicate plate within this vendor
    const { data: duplicate } = await admin
      .from('customer_vehicles')
      .select('id')
      .eq('vendor_id', vendor.id)
      .eq('plate_no', normalizedPlate)
      .maybeSingle()

    if (duplicate) {
      return NextResponse.json(
        { error: 'A vehicle with this plate number already exists' },
        { status: 409 }
      )
    }

    const { data: vehicle, error } = await admin
      .from('customer_vehicles')
      .insert({
        vendor_id: vendor.id,
        plate_no: normalizedPlate,
        make: make?.trim() || null,
        model: model?.trim() || null,
        year: year ?? null,
        color: color?.trim() || null,
        fuel_type: fuel_type ?? null,
        engine_no: engine_no?.trim() || null,
        chassis_no: chassis_no?.trim() || null,
        notes: notes?.trim() || null,
        fleet_account_id: fleet_account_id ?? null,
        customer_id: customer_id ?? null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, vehicle })
  }

  if (action === 'update') {
    const {
      vehicleId, plate_no, make, model, year, color,
      fuel_type, engine_no, chassis_no, notes,
      fleet_account_id, customer_id, is_active,
    } = body

    if (!vehicleId) return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 })

    // Verify the vehicle belongs to this vendor
    const { data: existing } = await admin
      .from('customer_vehicles')
      .select('id, plate_no')
      .eq('id', vehicleId)
      .eq('vendor_id', vendor.id)
      .single()

    if (!existing) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 })

    // Validate fuel_type if provided
    if (fuel_type !== undefined && fuel_type !== null && !VALID_FUEL_TYPES.includes(fuel_type as FuelType)) {
      return NextResponse.json(
        { error: `fuel_type must be one of: ${VALID_FUEL_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Build patch with only provided fields
    const patch: Record<string, unknown> = {}

    if (plate_no !== undefined) {
      const normalizedPlate = plate_no.trim().toUpperCase()

      // Check for duplicate (excluding this vehicle)
      const { data: duplicate } = await admin
        .from('customer_vehicles')
        .select('id')
        .eq('vendor_id', vendor.id)
        .eq('plate_no', normalizedPlate)
        .neq('id', vehicleId)
        .maybeSingle()

      if (duplicate) {
        return NextResponse.json(
          { error: 'A vehicle with this plate number already exists' },
          { status: 409 }
        )
      }

      patch.plate_no = normalizedPlate
    }

    if (make !== undefined) patch.make = make?.trim() || null
    if (model !== undefined) patch.model = model?.trim() || null
    if (year !== undefined) patch.year = year ?? null
    if (color !== undefined) patch.color = color?.trim() || null
    if (fuel_type !== undefined) patch.fuel_type = fuel_type ?? null
    if (engine_no !== undefined) patch.engine_no = engine_no?.trim() || null
    if (chassis_no !== undefined) patch.chassis_no = chassis_no?.trim() || null
    if (notes !== undefined) patch.notes = notes?.trim() || null
    if (fleet_account_id !== undefined) patch.fleet_account_id = fleet_account_id ?? null
    if (customer_id !== undefined) patch.customer_id = customer_id ?? null
    if (is_active !== undefined) patch.is_active = Boolean(is_active)

    const { error } = await admin
      .from('customer_vehicles')
      .update(patch)
      .eq('id', vehicleId)
      .eq('vendor_id', vendor.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
