import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Sends a Supabase password-recovery email linking to /reset-password.
// (This file was previously overwritten with an unrelated copy of the products
// route, which silently broke password resets for everyone — the page always
// got "Not authorized". Keep this route minimal and auth-only.)
export async function POST(req: NextRequest) {
  let email = ''
  try {
    const body = await req.json()
    email = String(body.email || '').trim().toLowerCase()
  } catch {}
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.kuruma.lk'
  const admin = createAdminClient()
  const { error } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: `${site}/reset-password`,
  })
  // Log real failures, but never reveal to the caller whether the email exists
  if (error) console.error('forgot-password:', error.message)
  return NextResponse.json({ success: true })
}
