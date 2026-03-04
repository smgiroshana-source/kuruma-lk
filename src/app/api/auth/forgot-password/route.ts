// ============================================================
// FILE: src/app/api/auth/forgot-password/route.ts
// NEW FILE
// FEATURE: 7 (Forgot password - sends reset email)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const { email } = await req.json()

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://kuruma.lk'

  try {
    const { error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: email.trim(),
      options: {
        redirectTo: `${siteUrl}/reset-password`,
      },
    })

    // Log for debugging but don't expose to user
    // Always return success to prevent email enumeration attacks
    if (error) {
      console.error('Password reset error:', error.message)
    }
  } catch (err) {
    console.error('Password reset exception:', err)
  }

  return NextResponse.json({
    success: true,
    message: 'If an account exists with this email, a reset link has been sent.'
  })
}
