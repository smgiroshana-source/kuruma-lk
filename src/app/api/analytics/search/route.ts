import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { query, category, conditionFilter, makeFilter, resultCount } = body

    if (!query && !category && !conditionFilter && !makeFilter) {
      return NextResponse.json({ ok: true })
    }

    let userId: string | null = null
    try {
      const userSupabase = await createServerSupabase()
      const { data: { user } } = await userSupabase.auth.getUser()
      userId = user?.id ?? null
    } catch {
      // Anonymous users are fine
    }

    const admin = createAdminClient()
    await admin.from('search_logs').insert({
      query: (query || '').trim().toLowerCase().slice(0, 200),
      category: category && category !== 'All' ? category : null,
      condition_filter: conditionFilter && conditionFilter !== 'All' ? conditionFilter : null,
      make_filter: makeFilter && makeFilter !== 'All' ? makeFilter : null,
      result_count: resultCount ?? 0,
      user_id: userId,
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
