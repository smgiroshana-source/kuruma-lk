// ============================================================
// FILE: src/app/api/vendor/settings/route.ts
// REPLACES: the entire existing file
// FEATURE: 8 (Vendor detail changes with admin approval)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { vendor: null, user: null }
  const admin = createAdminClient()
  let { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (!vendor) {
    const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
    if (staffLink?.vendor) {
      vendor = staffLink.vendor
      return { vendor, user, staff: staffLink }
    }
  }
  return { vendor, user }
}

export async function GET(req: NextRequest) {
  const { vendor, user, staff } = await getVendor() as any
  if (!vendor) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const admin = createAdminClient()
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (action === 'staff') {
    if (staff) return NextResponse.json({ error: 'Only owner can manage staff' }, { status: 403 })
    const { data: staffList } = await admin.from('vendor_staff').select('*').eq('vendor_id', vendor.id).eq('active', true).order('created_at')
    return NextResponse.json({ staff: staffList || [] })
  }

  const { data: settings } = await admin.from('vendor_settings').select('*').eq('vendor_id', vendor.id).single()

  return NextResponse.json({
    settings: settings || {},
    vendor,
    role: staff ? staff.role : 'owner',
  })
}

export async function POST(req: NextRequest) {
  const { vendor, user, staff } = await getVendor() as any
  if (!vendor) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const admin = createAdminClient()
  const contentType = req.headers.get('content-type') || ''

  // Logo upload (multipart form)
  if (contentType.includes('multipart/form-data')) {
    if (staff) return NextResponse.json({ error: 'Only owner can upload logo' }, { status: 403 })
    try {
      const formData = await req.formData()
      const file = formData.get('file') as File
      if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

      const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
      const fileName = `logos/${vendor.id}/logo.${ext}`
      const buffer = Buffer.from(await file.arrayBuffer())

      const { error: uploadError } = await admin.storage.from('vendor-assets').upload(fileName, buffer, {
        contentType: file.type, upsert: true,
      })
      if (uploadError) return NextResponse.json({ error: 'Upload failed: ' + uploadError.message }, { status: 500 })

      const { data: urlData } = admin.storage.from('vendor-assets').getPublicUrl(fileName)
      const logo_url = urlData.publicUrl

      await admin.from('vendor_settings').upsert({
        vendor_id: vendor.id, logo_url, updated_at: new Date().toISOString(),
      }, { onConflict: 'vendor_id' })

      return NextResponse.json({ logo_url })
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
  }

  // JSON actions
  const body = await req.json()
  const { action } = body

  if (action === 'update_settings') {
    if (staff) return NextResponse.json({ error: 'Only owner can change settings' }, { status: 403 })
    const { settings } = body
    const { error } = await admin.from('vendor_settings').upsert({
      vendor_id: vendor.id,
      invoice_title: settings.invoice_title || null,
      invoice_footer: settings.invoice_footer || null,
      invoice_terms: settings.invoice_terms || null,
      invoice_show_logo: settings.invoice_show_logo ?? true,
      tax_id: settings.tax_id || null,
      email: settings.email || null,
      logo_url: settings.logo_url || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'vendor_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // ─── [MODIFIED] UPDATE VENDOR — now with admin approval for key fields ───
  if (action === 'update_vendor') {
    if (staff) return NextResponse.json({ error: 'Only owner can edit shop info' }, { status: 403 })

    const { name, location, address, phone, whatsapp, description } = body

    // Fields that require admin approval before they take effect
    const APPROVAL_FIELDS = ['name', 'phone', 'whatsapp', 'location']

    // Get current vendor data for comparison
    const { data: currentVendor } = await admin.from('vendors').select('*').eq('id', vendor.id).single()
    if (!currentVendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    const requestedChanges: Record<string, any> = {}
    const autoChanges: Record<string, any> = {}
    const currentValues: Record<string, any> = {}

    const allChanges: Record<string, any> = { name, location, address, phone, whatsapp, description }

    for (const [key, value] of Object.entries(allChanges)) {
      if (value === undefined) continue
      const current = (currentVendor as any)[key]
      if (value === current) continue // No actual change

      if (APPROVAL_FIELDS.includes(key)) {
        requestedChanges[key] = value
        currentValues[key] = current
      } else {
        autoChanges[key] = value
      }
    }

    // Apply auto-approved changes immediately (address, description)
    if (Object.keys(autoChanges).length > 0) {
      const { error } = await admin.from('vendors').update(autoChanges).eq('id', vendor.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Create change request for approval-required fields
    let changeRequestId = null
    if (Object.keys(requestedChanges).length > 0) {
      // Check for existing pending request
      const { data: existing } = await admin
        .from('vendor_change_requests')
        .select('id')
        .eq('vendor_id', vendor.id)
        .eq('status', 'pending')
        .single()

      if (existing) {
        // Update existing pending request
        const { error } = await admin
          .from('vendor_change_requests')
          .update({
            requested_changes: requestedChanges,
            current_values: currentValues,
            requested_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        changeRequestId = existing.id
      } else {
        // Create new request
        const { data: req, error } = await admin
          .from('vendor_change_requests')
          .insert({
            vendor_id: vendor.id,
            requested_changes: requestedChanges,
            current_values: currentValues,
          })
          .select()
          .single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        changeRequestId = req?.id
      }
    }

    const messages = []
    if (Object.keys(autoChanges).length > 0) messages.push('Address/description updated')
    if (Object.keys(requestedChanges).length > 0) {
      messages.push(`Changes to ${Object.keys(requestedChanges).join(', ')} sent for admin approval`)
    }
    if (messages.length === 0) messages.push('No changes detected')

    return NextResponse.json({
      success: true,
      pendingApproval: Object.keys(requestedChanges).length > 0,
      changeRequestId,
      message: messages.join('. '),
    })
  }

  // ─── [NEW] GET PENDING CHANGE REQUEST ───
  if (action === 'get_change_request') {
    const { data: request } = await admin
      .from('vendor_change_requests')
      .select('*')
      .eq('vendor_id', vendor.id)
      .eq('status', 'pending')
      .order('requested_at', { ascending: false })
      .limit(1)
      .single()

    return NextResponse.json({ success: true, request: request || null })
  }

  if (action === 'change_password') {
    const supabase = await createServerSupabase()
    const { error } = await supabase.auth.updateUser({ password: body.password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  if (action === 'add_staff') {
    if (staff) return NextResponse.json({ error: 'Only owner can manage staff' }, { status: 403 })
    const { email, name, role, pin } = body

    const { data: existingUsers } = await admin.auth.admin.listUsers()
    let staffUser = existingUsers?.users?.find((u: any) => u.email === email)

    if (!staffUser) {
      const tempPassword = 'Staff' + Math.random().toString(36).slice(2, 10) + '!'
      const { data: newUser, error: createError } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      })
      if (createError) return NextResponse.json({ error: 'Failed to create user: ' + createError.message }, { status: 400 })
      staffUser = newUser.user
    }

    if (!staffUser) return NextResponse.json({ error: 'Could not find/create user' }, { status: 400 })

    const { data: existing } = await admin.from('vendor_staff').select('id').eq('vendor_id', vendor.id).eq('user_id', staffUser.id).eq('active', true).single()
    if (existing) return NextResponse.json({ error: 'Already a staff member' }, { status: 400 })

    const { error: insertError } = await admin.from('vendor_staff').insert({
      vendor_id: vendor.id,
      user_id: staffUser.id,
      name,
      email,
      role: role || 'cashier',
      pin: pin || null,
      active: true,
    })

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (action === 'remove_staff') {
    if (staff) return NextResponse.json({ error: 'Only owner can manage staff' }, { status: 403 })
    const { staff_id } = body
    await admin.from('vendor_staff').update({ active: false }).eq('id', staff_id).eq('vendor_id', vendor.id)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
