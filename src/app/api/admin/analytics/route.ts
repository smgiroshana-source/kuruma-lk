import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { ADMIN_EMAILS } from '@/lib/constants'

export async function GET(request: NextRequest) {
  const userSupabase = await createServerSupabase()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get('days') || '30')
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const [topQueries, topCategories, topMakes, dailyVolume, zeroResults, totalCount] = await Promise.all([
    admin.rpc('get_top_searches', { since_date: since, limit_count: 20 }),
    admin.rpc('get_top_categories', { since_date: since, limit_count: 10 }),
    admin.rpc('get_top_makes', { since_date: since, limit_count: 10 }),
    admin.rpc('get_daily_search_volume', { since_date: since }),
    admin.rpc('get_zero_result_searches', { since_date: since, limit_count: 15 }),
    admin.from('search_logs').select('*', { count: 'exact', head: true }).gte('created_at', since),
  ])

  return NextResponse.json({
    topQueries: topQueries.data || [],
    topCategories: topCategories.data || [],
    topMakes: topMakes.data || [],
    dailyVolume: dailyVolume.data || [],
    zeroResults: zeroResults.data || [],
    totalSearches: totalCount.count || 0,
    days,
  })
}
