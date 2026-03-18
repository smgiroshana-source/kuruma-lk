import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { ADMIN_EMAILS } from '@/lib/constants'

export async function GET() {
  const userSupabase = await createServerSupabase()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: synonyms } = await admin
    .from('search_synonyms')
    .select('*')
    .order('created_at', { ascending: false })

  return NextResponse.json({ synonyms: synonyms || [] })
}

export async function POST(request: NextRequest) {
  const userSupabase = await createServerSupabase()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await request.json()
  const { action, id, keywords } = body
  const admin = createAdminClient()

  switch (action) {
    case 'create': {
      const cleaned = (keywords as string[]).map(k => k.trim().toLowerCase()).filter(Boolean)
      if (cleaned.length < 2) return NextResponse.json({ error: 'Need at least 2 keywords' }, { status: 400 })
      const { error } = await admin.from('search_synonyms').insert({ keywords: cleaned })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true })
    }

    case 'update': {
      const cleaned = (keywords as string[]).map(k => k.trim().toLowerCase()).filter(Boolean)
      if (cleaned.length < 2) return NextResponse.json({ error: 'Need at least 2 keywords' }, { status: 400 })
      const { error } = await admin.from('search_synonyms').update({ keywords: cleaned }).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true })
    }

    case 'delete': {
      const { error } = await admin.from('search_synonyms').delete().eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true })
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
}
