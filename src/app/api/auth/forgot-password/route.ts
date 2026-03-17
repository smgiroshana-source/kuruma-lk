import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { email } = await req.json()

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://kuruma.lk'
  const supabase = await createServerSupabase()

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${siteUrl}/reset-password`,
    })

    if (error) {
      console.error('Password reset error:', error.message)
    }
  } catch (err) {
    console.error('Password reset exception:', err)
  }

  // Always return success to prevent email enumeration attacks
  return NextResponse.json({
    success: true,
    message: 'If an account exists with this email, a reset link has been sent.'
  })
}
