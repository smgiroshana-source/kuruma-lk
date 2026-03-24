import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  // Create response first so we can set cookies on it
  let response = NextResponse.json({ success: false })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    response = NextResponse.json({ error: error.message }, { status: 400 })
    return response
  }

  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase())
  const isAdmin = adminEmails.includes(data.user?.email?.toLowerCase() || '')

  let redirect = '/vendor'
  let jsonResponse: any = { success: true, redirect }

  if (isAdmin) {
    jsonResponse = { success: true, redirect: '/admin' }
  } else {
    // Check if direct vendor owner
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()
    const { data: vendor } = await admin.from('vendors').select('id, status').eq('user_id', data.user.id).single()

    if (vendor && vendor.status === 'approved') {
      jsonResponse = { success: true, redirect: '/vendor' }
    } else {
      // Check if staff member
      const { data: staffLink } = await admin.from('vendor_staff').select('id').eq('user_id', data.user.id).eq('active', true).single()
      if (staffLink) {
        jsonResponse = { success: true, redirect: '/vendor' }
      } else if (vendor && vendor.status === 'pending') {
        jsonResponse = { error: 'Your shop is pending approval.' }
        response = NextResponse.json(jsonResponse, { status: 403 })
        return response
      } else {
        jsonResponse = { error: 'No vendor account found.' }
        response = NextResponse.json(jsonResponse, { status: 403 })
        return response
      }
    }
  }

  // Create final response with the auth cookies preserved
  const finalResponse = NextResponse.json(jsonResponse)
  // Copy all cookies from the supabase response
  response.cookies.getAll().forEach(cookie => {
    finalResponse.cookies.set(cookie.name, cookie.value, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
    })
  })

  return finalResponse
}
